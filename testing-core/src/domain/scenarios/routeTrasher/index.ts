import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, RouteTrashMetadata } from '../../chaos/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { captureNavStep } from '../../../infrastructure/monitoring/navForensics.js';
import { DomHasher } from '../../../ml/domHasher.js';
import { wait } from '../rapidClicker/utils.js';
import {
  safeNavigation,
  safeGoto,
  rapidHistoryTraversal,
} from './navigation.js';
import { RouteTrashMetadataRecorder } from '../../services/forensics/metadataRecorder.js';
import {
  classifyNavStep,
  isWhiteScreenFailure,
  type RenderProbe,
} from './routeTrashClassifier.js';
import {
  describeRouteTrashStart,
  describeRouteTrashNavigation,
  describeRouteInconsistency,
  describeRouteTrashDrift,
  describeRouteTrashServerError,
  describeRouteTrashDefensive,
  describeRouteTrashClientCrash,
  describeRouteTrashWhiteScreen,
} from '../../services/forensics/narration.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StressScenario:RouteTrasher]');

// One shared DOM hasher for the run — its combined fingerprint is what every
// navigation snapshot measures "did the DOM actually update" against.
const navHasher = new DomHasher();

/**
 * The summary returned to the engine after a route-trash run. Cycle-aware:
 * `returnedToOrigin` signals whether the bursts net-landed back on the origin
 * path, `finalUrl` is where the page rests after origin-restore.
 */
export interface RouteTrashResult {
  attempted: number;
  completed: number;
  finalUrl: string;
  returnedToOrigin: boolean;
  /** Count of steps where the URL changed but the DOM did not update to match. */
  inconsistencies: number;
  /** Backend 5xx / soft-fail failures provoked by mutations (MEDIUM severity). */
  serverErrors: number;
  /** Expected defensive 4xx responses met, handled gracefully (INFORMATIONAL). */
  defensiveResponses: number;
  /** Unhandled client-side exceptions + white-screen render failures (CRITICAL). */
  clientCrashes: number;
}

/** Default number of back/forward/mutation iterations. */
const NAVIGATION_REPETITIONS = 5;
/** Small settling delay between the three deliberate actions in an iteration. */
const INTER_ACTION_DELAY_MS = 50;

export interface RouteTrashOptions {
  /** Override the iteration count (defaults to NAVIGATION_REPETITIONS). */
  repetitions?: number;
}

/**
 * Route Trasher stress scenario.
 *
 * Per iteration it drives native `goBack` then `goForward`, settling for SPA
 * render between each so the client router is never driven mid-render. It never
 * synthesizes routes — only real browser history entries are exercised, so SPA
 * routing and history behavior are validated without fabricated URLs. Every
 * deliberate step is recorded into the active scenario
 * window (for the immutable failure snapshot) and into the shared
 * `RouteTrashMetadata` (repetitions, history index, visited routes, resulting
 * state) so live telemetry and stored findings stay consistent and reproducible.
 *
 * Non-relocating: the page is always restored to the origin path so the engine's
 * breadcrumb/verify sees the true pre-stress state.
 */
export const routeTrasher = {
  name: 'RouteTrasher',

  async execute(
    page: Page,
    target?: InteractiveElement,
    chaosManager?: ChaosTransactionManager<RouteTrashMetadata> | null,
    options?: RouteTrashOptions,
  ): Promise<RouteTrashResult> {
    const repetitions =
      options?.repetitions && Number.isFinite(options.repetitions) && options.repetitions > 0
        ? Math.floor(options.repetitions)
        : NAVIGATION_REPETITIONS;

    const originPath = page.url();
    const metadata: RouteTrashMetadata = {
      originPath,
      targetPath: '',
      repetitions,
      historyIndex: 0,
      visitedRoutes: [originPath],
      resultingState: 'restored-to-origin',
    };

    const manager = chaosManager ?? null;
    const targetSelector = target?.selector || 'window';
    if (manager) {
      // The same metadata object is exposed via getActiveMetadata() by reference,
      // so the recorder's mutations flow straight into the live transaction.
      manager.startTransaction(targetSelector, 'ROUTE_TRASH', metadata);
    } else {
      obsLog.info(
        '[StressScenario:RouteTrasher] No ChaosTransactionManager provided - running without transaction tracking',
      );
    }

    const recorder = new RouteTrashMetadataRecorder(metadata);

    obsLog.info(`[StressScenario:RouteTrasher] Starting route trashing with ${repetitions} repetitions`);
    const trashSummary = describeRouteTrashStart(repetitions, originPath);
    ActiveScenarioTracker.record(trashSummary);
    // One re-expandable MACRO for the finding's replay timeline. The history
    // back/forward sequence is fully deterministic from {repetitions}; a literal
    // per-nav step would replay as a selector click and reproduce nothing.
    ActionRecorder.recordStep({
      actionType: 'MACRO',
      humanIdentifier: '',
      elementKind: 'browser history',
      selector: targetSelector,
      url: originPath,
      macro: {
        scenario: 'RouteTrasher',
        params: { repetitions },
        summary: trashSummary,
      },
    });

    let attempted = 0;
    let completed = 0;
    let inconsistencies = 0;
    // Centralized three-tier classification tallies (see routeTrashClassifier).
    let serverErrors = 0;
    let defensiveResponses = 0;
    let clientCrashes = 0;
    // Cycle-awareness: whether the bursts net-landed on origin, and where the
    // page rests after restore. This scenario is non-relocating.
    let finalUrl = originPath;
    let returnedToOrigin = true;

    // Wrap a navigation action in a synchronous, immutable forensic snapshot
    // (pre/post URL + DOM hash + route state + network/console anomalies). Any
    // URL-changed-without-DOM-update inconsistency is surfaced into the failure
    // window so regression replay can reproduce it. Each step's observed effects
    // are run through the centralized classifier and narrated at their tier —
    // findings themselves are owned by the globally-attached StabilityMonitor, so
    // this only records severity-labelled evidence into the scenario window.
    const runStep = async (navType: string, navFn: () => Promise<void>) => {
      const snap = await captureNavStep(
        page,
        (p) => navHasher.hash(p),
        { navigationType: navType, fromUrl: page.url() },
        navFn,
      );
      if (snap.urlChangedWithoutDom) {
        inconsistencies++;
        ActiveScenarioTracker.observe(describeRouteInconsistency(snap.fromUrl, snap.toUrl));
      }

      const verdict = classifyNavStep(snap);
      serverErrors += verdict.serverErrors;
      defensiveResponses += verdict.defensiveResponses;
      clientCrashes += verdict.clientCrashes;
      if (verdict.clientCrashes > 0) {
        ActiveScenarioTracker.observe(describeRouteTrashClientCrash(navType, verdict.clientCrashes, snap.toUrl));
      }
      if (verdict.serverErrors > 0) {
        ActiveScenarioTracker.observe(describeRouteTrashServerError(navType, verdict.serverErrors, snap.toUrl));
      }
      if (verdict.defensiveResponses > 0) {
        ActiveScenarioTracker.observe(describeRouteTrashDefensive(navType, verdict.defensiveResponses, snap.toUrl));
      }
      return snap;
    };

    // Probe the rendered page for a white-screen (blank/render failure) after
    // history navigation. Never throws — a teardown race yields no probe (treated
    // as no failure) so the scenario keeps running.
    const probeWhiteScreen = async (navType: string): Promise<void> => {
      let probe: RenderProbe;
      try {
        probe = await page.evaluate((): RenderProbe => {
          const body = document.body;
          if (!body) {
            return { visibleTextLength: 0, visibleElementCount: 0, hasBody: false };
          }
          return {
            visibleTextLength: (body.innerText || '').trim().length,
            visibleElementCount: body.querySelectorAll('*').length,
            hasBody: true,
          };
        });
      } catch {
        return;
      }
      if (isWhiteScreenFailure(probe)) {
        clientCrashes++;
        ActiveScenarioTracker.observe(describeRouteTrashWhiteScreen(navType, page.url()));
      }
    };

    try {
      // Opening rapid-history churn: drive back/forward faster than the router can
      // commit, stressing the SPA's history handling before the per-iteration pairs.
      attempted++;
      const churn = await runStep('rapid_history', async () => {
        await rapidHistoryTraversal(page, 2, originPath);
      });
      if (churn.urlChanged || churn.domChanged) completed++;
      await wait(INTER_ACTION_DELAY_MS);

      for (let i = 0; i < repetitions; i++) {
        // 1) History back
        attempted++;
        let ran = false;
        const backSnap = await runStep('history_back', async () => {
          ran = await safeNavigation(page, 'goBack', 1200, originPath);
        });
        if (ran) {
          completed++;
          recorder.record('history_back', backSnap.toUrl);
          ActiveScenarioTracker.record(describeRouteTrashNavigation(i + 1, 'back', backSnap.toUrl));
        }
        await wait(INTER_ACTION_DELAY_MS);

        // 2) History forward
        attempted++;
        ran = false;
        const fwdSnap = await runStep('history_forward', async () => {
          ran = await safeNavigation(page, 'goForward', 1200, originPath);
        });
        if (ran) {
          completed++;
          recorder.record('history_forward', fwdSnap.toUrl);
          ActiveScenarioTracker.record(describeRouteTrashNavigation(i + 1, 'forward', fwdSnap.toUrl));
        }
        await wait(INTER_ACTION_DELAY_MS);

        // After the native back/forward pair, check whether the history hops drove
        // the app into a white/blank screen (CRITICAL render failure).
        await probeWhiteScreen('history_navigation');
        await wait(INTER_ACTION_DELAY_MS);
      }
    } finally {
      // Cycle-aware restore: net-land back on origin so the engine's verify sees
      // the true pre-stress state. returnedToOrigin records whether it had drifted.
      try {
        const landed = page.url();
        returnedToOrigin = landed === originPath;
        if (!returnedToOrigin) {
          ActiveScenarioTracker.observe(describeRouteTrashDrift(landed, originPath));
          await safeGoto(page, originPath, 5000);
        }
        finalUrl = page.url();
        recorder.finalize(returnedToOrigin ? 'restored-to-origin' : 'drifted', finalUrl);
      } catch (error) {
        obsLog.warn(
          `[StressScenario:RouteTrasher] Origin restore failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        finalUrl = page.url();
        recorder.finalize('error', finalUrl);
      }

      // Settle network before ending the transaction so pending async telemetry
      // is captured against this transaction rather than leaking past it.
      try {
        await page.waitForLoadState('networkidle', { timeout: 2000 });
      } catch {
        obsLog.info('[StressScenario:RouteTrasher] Network idle timeout, proceeding with transaction end');
      }
      await wait(100);

      manager?.endTransaction();
    }

    obsLog.info(
      `[StressScenario:RouteTrasher] Completed ${completed}/${attempted} navigation actions ` +
        `(returnedToOrigin=${returnedToOrigin}, inconsistencies=${inconsistencies}, ` +
        `serverErrors=${serverErrors}, defensiveResponses=${defensiveResponses}, clientCrashes=${clientCrashes})`,
    );

    return {
      attempted,
      completed,
      finalUrl,
      returnedToOrigin,
      inconsistencies,
      serverErrors,
      defensiveResponses,
      clientCrashes,
    };
  },
};

export type RouteTrasher = typeof routeTrasher;

/**
 * Re-export for backwards compatibility with existing code.
 * @deprecated Use the `routeTrasher` export instead.
 */
export async function trashRoutes(
  page: Page,
  target?: InteractiveElement,
  chaosManager?: ChaosTransactionManager<RouteTrashMetadata> | null,
): Promise<RouteTrashResult> {
  return routeTrasher.execute(page, target, chaosManager);
}

export { routeTrasher as executeTrashRoutes };

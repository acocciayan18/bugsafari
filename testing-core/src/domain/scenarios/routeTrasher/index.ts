import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, RouteTrashMetadata } from '../../chaos/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { captureNavStep } from '../../../infrastructure/monitoring/navForensics.js';
import { DomHasher } from '../../../ml/domHasher.js';
import { wait } from '../rapidClicker/utils.js';
import {
  safeNavigation,
  safeGoto,
  assertWithinOrigin,
  rapidHistoryTraversal,
  interruptedTransition,
} from './navigation.js';
import { mutateQueryParams, QUERY_MUTATIONS, type QueryMutationOutcome } from './queryMutation.js';
import { mutateRoutePath, mutateHashRoute, type RouteMutationOutcome } from './pathMutation.js';
import { RouteTrashMetadataRecorder } from '../../services/forensics/metadataRecorder.js';
import {
  describeRouteTrashStart,
  describeRouteTrashNavigation,
  describeRouteTrashMutation,
  describeRouteTrashPathMutation,
  describeRouteTrashHashMutation,
  describeRouteTrashInterrupted,
  describeRouteInconsistency,
  describeRouteTrashDrift,
} from '../../services/forensics/narration.js';

// One shared DOM hasher for the run — its combined fingerprint is what every
// navigation snapshot measures "did the DOM actually update" against.
const navHasher = new DomHasher();

export { QUERY_MUTATIONS, type QueryMutationType } from './queryMutation.js';

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
 * Per iteration it drives `goBack`, `goForward`, then a deterministic query-param
 * mutation, settling for SPA render between each so the client router is never
 * driven mid-render. Every deliberate step is recorded into the active scenario
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
      console.log(
        '[StressScenario:RouteTrasher] No ChaosTransactionManager provided - running without transaction tracking',
      );
    }

    const recorder = new RouteTrashMetadataRecorder(metadata);

    console.log(`[StressScenario:RouteTrasher] Starting route trashing with ${repetitions} repetitions`);
    ActiveScenarioTracker.record(describeRouteTrashStart(repetitions, originPath));

    let attempted = 0;
    let completed = 0;
    let inconsistencies = 0;
    // Cycle-awareness: whether the bursts net-landed on origin, and where the
    // page rests after restore. This scenario is non-relocating.
    let finalUrl = originPath;
    let returnedToOrigin = true;

    // Wrap a navigation action in a synchronous, immutable forensic snapshot
    // (pre/post URL + DOM hash + route state + network/console anomalies). Any
    // URL-changed-without-DOM-update inconsistency is surfaced into the failure
    // window so regression replay can reproduce it.
    const runStep = async (navType: string, navFn: () => Promise<void>) => {
      const snap = await captureNavStep(
        page,
        (p) => navHasher.hash(p),
        { navigationType: navType, fromUrl: page.url() },
        navFn,
      );
      if (snap.urlChangedWithoutDom) {
        inconsistencies++;
        ActiveScenarioTracker.record(describeRouteInconsistency(snap.fromUrl, snap.toUrl));
      }
      return snap;
    };

    try {
      // Opening rapid-history churn: drive back/forward faster than the router can
      // commit, stressing the SPA's history handling before the mutation bursts.
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
          ActiveScenarioTracker.record(
            describeRouteTrashNavigation(i + 1, 'back', recorder.historyIndex, backSnap.toUrl),
          );
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
          ActiveScenarioTracker.record(
            describeRouteTrashNavigation(i + 1, 'forward', recorder.historyIndex, fwdSnap.toUrl),
          );
        }
        await wait(INTER_ACTION_DELAY_MS);

        // 3) Deterministic query-param mutation (round-robin by iteration)
        attempted++;
        const mutation = QUERY_MUTATIONS[i % QUERY_MUTATIONS.length];
        let queryOutcome: QueryMutationOutcome = { mutated: false, resultingUrl: page.url() };
        await runStep('query_mutation', async () => {
          queryOutcome = await mutateQueryParams(page, mutation, i);
        });
        if (queryOutcome.mutated) {
          completed++;
          recorder.record('query_mutation', queryOutcome.resultingUrl);
          ActiveScenarioTracker.record(
            describeRouteTrashMutation(i + 1, queryOutcome.param, queryOutcome.mutation, queryOutcome.resultingUrl),
          );
        }
        await wait(INTER_ACTION_DELAY_MS);

        // 4) One advanced attack per iteration, rotated deterministically:
        //    malformed dynamic route param → hash-route mutation → interrupted transition.
        attempted++;
        switch (i % 3) {
          case 0: {
            let pathOutcome: RouteMutationOutcome = { mutated: false, resultingUrl: page.url() };
            await runStep('malformed_push', async () => {
              pathOutcome = await mutateRoutePath(page, originPath, i);
            });
            if (pathOutcome.mutated) {
              completed++;
              recorder.record('malformed_push', pathOutcome.resultingUrl);
              ActiveScenarioTracker.record(
                describeRouteTrashPathMutation(i + 1, pathOutcome.mutation, pathOutcome.resultingUrl),
              );
            }
            break;
          }
          case 1: {
            let hashOutcome: RouteMutationOutcome = { mutated: false, resultingUrl: page.url() };
            await runStep('hash_mutation', async () => {
              hashOutcome = await mutateHashRoute(page, i);
            });
            if (hashOutcome.mutated) {
              completed++;
              recorder.record('hash_mutation', hashOutcome.resultingUrl);
              ActiveScenarioTracker.record(
                describeRouteTrashHashMutation(i + 1, hashOutcome.mutation, hashOutcome.resultingUrl),
              );
            }
            break;
          }
          default: {
            // Interrupt a pending transition: fire a same-origin load, then a second
            // navigation mid-flight. Both candidates are origin-guarded.
            const firstUrl = `${originPath}${originPath.includes('?') ? '&' : '?'}_rt=${i}`;
            const secondUrl = originPath;
            if (assertWithinOrigin(firstUrl, originPath) && assertWithinOrigin(secondUrl, originPath)) {
              let ranInterrupt = false;
              const intSnap = await runStep('interrupted_transition', async () => {
                ranInterrupt = await interruptedTransition(page, firstUrl, secondUrl);
              });
              if (ranInterrupt) {
                completed++;
                recorder.record('interrupted_transition', intSnap.toUrl);
                ActiveScenarioTracker.record(describeRouteTrashInterrupted(i + 1, intSnap.toUrl));
              }
            }
            break;
          }
        }
        await wait(INTER_ACTION_DELAY_MS);
      }
    } finally {
      // Cycle-aware restore: net-land back on origin so the engine's verify sees
      // the true pre-stress state. returnedToOrigin records whether it had drifted.
      try {
        const landed = page.url();
        returnedToOrigin = landed === originPath;
        if (!returnedToOrigin) {
          ActiveScenarioTracker.record(describeRouteTrashDrift(landed, originPath));
          await safeGoto(page, originPath, 5000);
        }
        finalUrl = page.url();
        recorder.finalize(returnedToOrigin ? 'restored-to-origin' : 'drifted', finalUrl);
      } catch (error) {
        console.warn(
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
        console.log('[StressScenario:RouteTrasher] Network idle timeout, proceeding with transaction end');
      }
      await wait(100);

      manager?.endTransaction();
    }

    console.log(
      `[StressScenario:RouteTrasher] Completed ${completed}/${attempted} navigation actions ` +
        `(returnedToOrigin=${returnedToOrigin}, inconsistencies=${inconsistencies})`,
    );

    return { attempted, completed, finalUrl, returnedToOrigin, inconsistencies };
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

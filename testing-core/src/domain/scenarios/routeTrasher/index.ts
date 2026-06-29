import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, RouteTrashMetadata } from '../../fuzzing/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { wait } from '../rapidClicker/utils.js';
import { safeNavigation, safeGoto } from './navigation.js';
import { mutateQueryParams, QUERY_MUTATIONS } from './queryMutation.js';
import { RouteTrashMetadataRecorder, type RouteTrashResult } from './metadata.js';

export type { RouteTrashResult } from './metadata.js';
export { QUERY_MUTATIONS, type QueryMutationType } from './queryMutation.js';

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
    ActiveScenarioTracker.record(
      `Trash navigation history (back/forward ${repetitions}×) and mutate URL query params from ${originPath}`,
    );

    let attempted = 0;
    let completed = 0;
    // Cycle-awareness: whether the bursts net-landed on origin, and where the
    // page rests after restore. This scenario is non-relocating.
    let finalUrl = originPath;
    let returnedToOrigin = true;

    try {
      for (let i = 0; i < repetitions; i++) {
        // 1) History back
        attempted++;
        if (await safeNavigation(page, 'goBack')) {
          completed++;
          const url = page.url();
          recorder.record('history_back', url);
          ActiveScenarioTracker.record(`Iteration ${i + 1}: history back (index ${recorder.historyIndex}) → ${url}`);
        }
        await wait(INTER_ACTION_DELAY_MS);

        // 2) History forward
        attempted++;
        if (await safeNavigation(page, 'goForward')) {
          completed++;
          const url = page.url();
          recorder.record('history_forward', url);
          ActiveScenarioTracker.record(`Iteration ${i + 1}: history forward (index ${recorder.historyIndex}) → ${url}`);
        }
        await wait(INTER_ACTION_DELAY_MS);

        // 3) Deterministic query-param mutation (round-robin by iteration)
        attempted++;
        const mutation = QUERY_MUTATIONS[i % QUERY_MUTATIONS.length];
        const outcome = await mutateQueryParams(page, mutation, i);
        if (outcome.mutated) {
          completed++;
          recorder.record('query_mutation', outcome.resultingUrl);
          ActiveScenarioTracker.record(
            `Iteration ${i + 1}: mutate query '${outcome.param}' via ${outcome.mutation} → ${outcome.resultingUrl}`,
          );
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
          ActiveScenarioTracker.record(`Route bursts drifted to ${landed}; restoring to origin ${originPath}.`);
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
      `[StressScenario:RouteTrasher] Completed ${completed}/${attempted} navigation actions (returnedToOrigin=${returnedToOrigin})`,
    );

    return { attempted, completed, finalUrl, returnedToOrigin };
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

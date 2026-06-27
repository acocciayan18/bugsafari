import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';
import type { ChaosTransactionManager, RouteTrashMetadata } from '../fuzzing/index.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';

export interface RouteTrashResult {
  attempted: number;
  completed: number;
}

/**
 * Configuration constants for route trasher scenario
 */
const NAVIGATION_REPETITIONS = 5;

/**
 * Error messages to ignore during route trashing
 */
const ERROR_MESSAGES = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  CONTEXT_DESTROYED: 'context destroyed',
  NAVIGATION: 'navigation',
} satisfies Record<string, string>;

/**
 * Checks if an error is a non-fatal navigation error that should be ignored.
 * @param error The error to check
 * @returns true if the error should be silently ignored
 */
function isNonFatalNavigationError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return Object.values(ERROR_MESSAGES).some((fatalMessage) =>
    message.includes(fatalMessage.toLowerCase())
  );
}

/**
 * Safely execute a navigation action, returning false on error.
 */
async function safeNavigation(
  page: Page,
  action: 'goBack' | 'goForward',
  waitUntil: 'domcontentloaded' | 'networkidle' = 'domcontentloaded',
  timeout: number = 1200
): Promise<boolean> {
  try {
    await page[action]({ waitUntil, timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mutation strategies for URL query string manipulation
 * Used to trigger hidden framework routing errors
 */
type QueryMutationType = 'nullify' | 'undefined' | 'nan' | 'extreme_int' | 'empty_string' | 'drop_param';

/**
 * Mutate URL query parameters to trigger hidden framework routing errors.
 * Extracts current URL parameters and randomly manipulates, mangles, or drops them.
 */
async function mutateQueryParams(
  page: Page,
  mutationType?: QueryMutationType
): Promise<boolean> {
  try {
    const currentUrl = page.url();
    const urlObj = new URL(currentUrl);
    const params = urlObj.searchParams;

    // If no params, there's nothing to mutate
    if (params.toString() === '') {
      return false;
    }

    // Get all param names
    const paramNames = Array.from(params.keys());
    if (paramNames.length === 0) {
      return false;
    }

    // Randomly select a param to mutate (if no mutationType specified)
    const targetParam = paramNames[Math.floor(Math.random() * paramNames.length)];
    const originalValue = params.get(targetParam);

    // Determine mutation type if not provided
    const mutation = mutationType ?? (
      ['nullify', 'undefined', 'nan', 'extreme_int', 'empty_string', 'drop_param'][
        Math.floor(Math.random() * 6)
      ]
    );

    // Apply mutation
    switch (mutation) {
      case 'nullify':
        params.set(targetParam, 'null');
        break;
      case 'undefined':
        params.set(targetParam, 'undefined');
        break;
      case 'nan':
        params.set(targetParam, 'NaN');
        break;
      case 'extreme_int':
        // Set to extreme integers (very large or very small)
        const extremeValue = Math.random() > 0.5 
          ? Number.MAX_SAFE_INTEGER.toString()
          : Number.MIN_SAFE_INTEGER.toString();
        params.set(targetParam, extremeValue);
        break;
      case 'empty_string':
        params.set(targetParam, '');
        break;
      case 'drop_param':
        params.delete(targetParam);
        break;
    }

    // Navigate to mutated URL
    await page.goto(urlObj.toString(), { waitUntil: 'domcontentloaded', timeout: 1000 });

    console.log(
      `[StressScenario:RouteTrasher] Query mutation: ${mutation} on param '${targetParam}' (was: ${originalValue}) -> ${params.get(targetParam) ?? '(removed)'}`
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Route Trasher stress scenario.
 *
 * Rapidly triggers page.goBack() and page.goForward() 5 times in succession.
 * This forces the SPA's router to re-render components in rapid succession
 * to check for desynchronization.
 *
 * This stress test is designed to:
 * - Trigger race conditions in SPA routing
 * - Find memory leaks in route change handlers
 * - Check for component desynchronization during navigation
 */
export const routeTrasher = {
  name: 'RouteTrasher',

async execute(
    page: Page,
    target: InteractiveElement | undefined,
    chaosManager: ChaosTransactionManager<RouteTrashMetadata>
  ): Promise<RouteTrashResult> {
    const repetitions =
      typeof target === 'number' && Number.isFinite(target) && target > 0
        ? Math.floor(target)
        : NAVIGATION_REPETITIONS;

const originPath = page.url();

    // Initialize enhanced metadata with navigation type detection
    const metadata: RouteTrashMetadata = {
      originPath: originPath,
      targetPath: '',
    };

    // Open transaction with enhanced metadata - use 'ROUTE_TRASH' as type per feedback
// Compute target selector: target?.selector || 'window'
    const targetSelector = target?.selector || 'window';
    
    // Use optional chaining with null check - chaosManager may be undefined
    if (chaosManager) {
      chaosManager.startTransaction(targetSelector, 'ROUTE_TRASH', metadata);
    } else {
      console.log('[StressScenario:RouteTrasher] No ChaosTransactionManager provided - running without transaction tracking');
    }

    console.log(
      `[StressScenario:RouteTrasher] Starting route trashing with ${repetitions} repetitions`
    );
    ActiveScenarioTracker.record(`Trash navigation history (back/forward ${repetitions}×) and mutate URL query params from ${originPath}`);

    let completed = 0;
    let attempted = 0;

    try {
      for (let i = 0; i < repetitions; i++) {
        attempted++;

        // goBack
        try {
          const backSuccess = await safeNavigation(page, 'goBack');
          if (backSuccess) {
            completed++;
            
            // Update metadata with navigation type
            if (chaosManager) {
              const activeMeta = chaosManager.getActiveMetadata();
              if (activeMeta) {
                activeMeta.injectedPath = page.url();
                activeMeta.navigationType = 'history_back';
                activeMeta.targetPath = page.url();
              }
            }
            
            console.log(
              `[StressScenario:RouteTrasher] Iteration ${i + 1}: goBack completed`
            );
          }
        } catch (error) {
          if (error instanceof Error && isNonFatalNavigationError(error)) {
            console.log(
              `[StressScenario:RouteTrasher] Ignored navigation error on goBack: ${error.message}`
            );
          } else if (error instanceof Error) {
            console.error(
              `[StressScenario:RouteTrasher] Non-fatal error on goBack: ${error.message}`
            );
          }
        }

        // Small delay between nav operations
        await new Promise((resolve) => setTimeout(resolve, 50));

        attempted++;

        // goForward
        try {
          const forwardSuccess = await safeNavigation(page, 'goForward');
          if (forwardSuccess) {
            completed++;
            
            // Update metadata with navigation type
            if (chaosManager) {
              const activeMeta = chaosManager.getActiveMetadata();
              if (activeMeta) {
                activeMeta.injectedPath = page.url();
                activeMeta.navigationType = 'history_forward';
                activeMeta.targetPath = page.url();
              }
            }
            
            console.log(
              `[StressScenario:RouteTrasher] Iteration ${i + 1}: goForward completed`
            );
          }
        } catch (error) {
          if (error instanceof Error && isNonFatalNavigationError(error)) {
            console.log(
              `[StressScenario:RouteTrasher] Ignored navigation error on goForward: ${error.message}`
            );
          } else if (error instanceof Error) {
            console.error(
              `[StressScenario:RouteTrasher] Non-fatal error on goForward: ${error.message}`
            );
          }
        }

// Small delay between iterations
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Third interaction: Query parameter mutation
        // This extracts current URL parameters and randomly manipulates them
        attempted++;
        try {
          const queryMutationSuccess = await mutateQueryParams(page);
          if (queryMutationSuccess) {
            completed++;
            
            // Update metadata with mutation type
            if (chaosManager) {
              const activeMeta = chaosManager.getActiveMetadata();
              if (activeMeta) {
                activeMeta.injectedPath = page.url();
                activeMeta.navigationType = 'query_mutation';
                activeMeta.targetPath = page.url();
              }
            }
            
            console.log(
              `[StressScenario:RouteTrasher] Iteration ${i + 1}: Query mutation completed`
            );
          }
        } catch (error) {
          if (error instanceof Error && isNonFatalNavigationError(error)) {
            console.log(
              `[StressScenario:RouteTrasher] Ignored error on query mutation: ${error.message}`
            );
          } else if (error instanceof Error) {
            console.error(
              `[StressScenario:RouteTrasher] Non-fatal error on query mutation: ${error.message}`
            );
          }
        }

        // Small delay after query mutation
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
} finally {
      // Wait for network settlement before ending transaction to prevent async telemetry leak
      // This ensures pending network requests are captured before transaction closes
      try {
        await page.waitForLoadState('networkidle', { timeout: 2000 });
      } catch {
        // Timeout is expected for long-polling connections, proceed anyway
        console.log('[StressScenario:RouteTrasher] Network idle timeout, proceeding with transaction end');
      }
      
// Additional stabilization delay to capture any remaining async events
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      // Always end transaction, even on error (use endTransaction per feedback)
      // Use optional chaining since chaosManager may be undefined
      chaosManager?.endTransaction();
    }

    console.log(
      `[StressScenario:RouteTrasher] Completed ${completed}/${attempted} navigation actions`
    );

    return { attempted, completed };
  },
};

/**
 * Type for the executeTrashRoutes function (backwards compatibility)
 */
export type RouteTrasher = typeof routeTrasher;

/**
 * Re-export for backwards compatibility with existing code
 * @deprecated Use the `routeTrasher` export instead
 */
export async function trashRoutes(
  page: Page,
  target: InteractiveElement | undefined,
  chaosManager: ChaosTransactionManager<RouteTrashMetadata>
): Promise<RouteTrashResult> {
  return routeTrasher.execute(page, target, chaosManager);
}

export { routeTrasher as executeTrashRoutes };

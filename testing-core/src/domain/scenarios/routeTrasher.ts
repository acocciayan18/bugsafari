import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

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

  async execute(page: Page, target?: InteractiveElement | number): Promise<RouteTrashResult> {
    const repetitions =
      typeof target === 'number' && Number.isFinite(target) && target > 0
        ? Math.floor(target)
        : NAVIGATION_REPETITIONS;

    console.log(
      `[StressScenario:RouteTrasher] Starting route trashing with ${repetitions} repetitions`
    );

    let completed = 0;
    let attempted = 0;

    for (let i = 0; i < repetitions; i++) {
      attempted++;

      // goBack
      try {
        const backSuccess = await safeNavigation(page, 'goBack');
        if (backSuccess) {
          completed++;
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
    }

    console.log(
      `[StressScenario:RouteTrasher] Completed ${completed}/${attempted} navigation actions`
    );

return { attempted, completed };
  },
};

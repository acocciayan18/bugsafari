import type { Page } from 'playwright';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

/**
 * Configuration constants for button spammer scenario
 */
const CLICK_COUNT = 15;
const CLICK_DELAY_MS = 50;

/**
 * Error messages for button spammer
 */
const ERROR_MESSAGES = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
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
 * Button Spammer stress scenario.
 *
 * Clicks the target element 15 times rapidly with 50ms delays between each click.
 * Does not await individual clicks to flood the browser event queue.
 *
 * This stress test is designed to:
 * - Overwhelm SPA state management
 * - Trigger race conditions in event handlers
 * - Test for memory leaks in click handlers
 */
export const buttonSpammer: StressScenario = {
  name: 'ButtonSpammer',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    // If no target is provided, try to find a clickable element
    const selector = target?.selector ?? 'button, [role="button"], a';

    console.log(
      `[StressScenario:ButtonSpammer] Starting spam with ${CLICK_COUNT} clicks on '${selector}'`
    );

    const clickPromises: Promise<void>[] = [];

    // Execute clicks rapidly without awaiting individual clicks
    // This floods the browser event queue
    for (let i = 0; i < CLICK_COUNT; i++) {
      const clickPromise = page
        .click(selector, { force: true })
        .then(() => {
          console.log(`[StressScenario:ButtonSpammer] Click ${i + 1}/${CLICK_COUNT} completed`);
        })
        .catch((error: Error) => {
          // Handle errors gracefully - don't let one failed click stop the scenario
          if (isNonFatalNavigationError(error)) {
            console.log(
              `[StressScenario:ButtonSpammer] Ignored navigation error on click ${i + 1}: ${error.message}`
            );
          } else {
            console.error(
              `[StressScenario:ButtonSpammer] Non-fatal error on click ${i + 1}: ${error.message}`
            );
          }
        });

      clickPromises.push(clickPromise);

      // Small delay between clicks (but we don't await the click itself)
      await new Promise((resolve) => setTimeout(resolve, CLICK_DELAY_MS));
    }

    // Wait for all click promises to settle (or fail)
    await Promise.allSettled(clickPromises);

    console.log(`[StressScenario:ButtonSpammer] Spam completed with ${CLICK_COUNT} clicks`);
  },
};

/**
 * Callable function for executing spam clicks.
 * This wraps the buttonSpammer StressScenario for direct function calls.
 * @param page Playwright Page object
 * @param selector CSS selector to click
 */
export async function executeSpam(page: Page, selector: string): Promise<void> {
  await buttonSpammer.execute(page, { selector } as InteractiveElement);
}

/**
 * Type for the buttonSpammer StressScenario (backwards compatibility)
 */
export type ButtonSpammer = typeof buttonSpammer;

import type { Page } from 'playwright';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

/**
 * Configuration constants for coordinate bombing scenario
 */
const BOMB_COUNT = 10;

/**
 * Error messages to ignore during coordinate bombing
 */
const ERROR_MESSAGES = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  CONTEXT_DESTROYED: 'context destroyed',
} satisfies Record<string, string>;

/**
 * Generates a random integer between min and max (inclusive).
 * @param min Minimum value
 * @param max Maximum value
 * @returns Random integer
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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
 * Coordinate Bombing stress scenario.
 *
 * Retrieves the page's viewport size, generates random X/Y coordinates,
 * and fires clicks at empty space or potentially hidden elements.
 *
 * This stress test is designed to:
 * - Find race conditions in click event handlers
 * - Test for memory leaks in position-based interactions
 * - Check for desynchronization in coordinate-dependent logic
 */
export const coordinateBombing: StressScenario = {
  name: 'CoordinateBombing',

  async execute(page: Page, _target?: InteractiveElement): Promise<void> {
    // Get viewport size
    const viewportSize = page.viewportSize();
    
    if (!viewportSize) {
      console.error('[StressScenario:CoordinateBombing] Unable to get viewport size');
      return;
    }

    const { width, height } = viewportSize;
    console.log(
      `[StressScenario:CoordinateBombing] Starting bombing on viewport ${width}x${height}`
    );

    // Generate and fire clicks at random coordinates
    for (let i = 0; i < BOMB_COUNT; i++) {
      const x = randomInt(0, width - 1);
      const y = randomInt(0, height - 1);

      try {
        await page.mouse.click(x, y);
        console.log(
          `[StressScenario:CoordinateBombing] Click ${i + 1}/${BOMB_COUNT} at (${x}, ${y})`
        );
      } catch (error) {
        // Handle errors gracefully
        if (error instanceof Error && isNonFatalNavigationError(error)) {
          console.log(
            `[StressScenario:CoordinateBombing] Ignored navigation error on click ${i + 1}: ${error.message}`
          );
        } else if (error instanceof Error) {
          console.error(
            `[StressScenario:CoordinateBombing] Non-fatal error on click ${i + 1}: ${error.message}`
          );
        }
      }

      // Small delay between clicks
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log(
      `[StressScenario:CoordinateBombing] Completed ${BOMB_COUNT} coordinate clicks`
    );
  },
};

/**
 * Type for the executeBombing function (backwards compatibility)
 */
export type CoordinateBombing = typeof coordinateBombing;

/**
 * Re-export for backwards compatibility with existing code
 * @deprecated Use the `coordinateBombing` export instead
 */
export { coordinateBombing as executeBombing };

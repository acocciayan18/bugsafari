/**
 * Coordinate Bombing Stress Scenario
 *
 * Retrieves the page's viewport size, generates random X/Y coordinates,
 * and fires clicks at empty space or potentially hidden elements.
 *
 * This stress test is designed to:
 * - Find race conditions in click event handlers
 * - Test for memory leaks in position-based interactions
 * - Check for desynchronization in coordinate-dependent logic
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { StressScenario } from '../types.js';
import { BOMB_COUNT, isNonFatalNavigationError, randomInt, wait } from './utils.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';

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
    const viewportSize = page.viewportSize();

    if (!viewportSize) {
      console.error('[StressScenario:CoordinateBombing] Unable to get viewport size');
      return;
    }

    const { width, height } = viewportSize;
    console.log(
      `[StressScenario:CoordinateBombing] Starting bombing on viewport ${width}x${height}`
    );
    ActiveScenarioTracker.record(`Fire ${BOMB_COUNT} random coordinate clicks across the ${width}x${height} viewport`);

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
      await wait(50);
    }

    console.log(
      `[StressScenario:CoordinateBombing] Completed ${BOMB_COUNT} coordinate clicks`
    );
  },
};

/**
 * Re-export of coordinateBombing for backwards compatibility
 * @deprecated Use coordinateBombing directly
 */
export const executeBombing = coordinateBombing;

/**
 * Coordinate Bombing Stress Scenario
 *
 * Fires BOMB_COUNT clicks at deterministic grid coordinates across the viewport
 * to hit empty space and potentially hidden/overlay elements. Coordinates are
 * derived from the iteration index (round-robin grid), so the same viewport +
 * count always produces the identical sequence — making any fault reproducible.
 *
 * This stress test is designed to:
 * - Find race conditions in click event handlers
 * - Surface desynchronization in coordinate-dependent logic
 * - Exercise overlay/hit-testing edge cases
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, StressClickMetadata } from '../../fuzzing/index.js';
import { BOMB_COUNT, isNonFatalNavigationError, wait } from './utils.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';

/**
 * Deterministic grid coordinate for click `index` over a width×height viewport.
 * Lays the BOMB_COUNT points on the smallest near-square grid, centring each
 * click within its cell so the spread is stable and reproducible.
 */
function gridCoordinate(index: number, count: number, width: number, height: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const col = index % cols;
  const row = Math.floor(index / cols) % rows;
  return {
    x: Math.floor(((col + 0.5) / cols) * width),
    y: Math.floor(((row + 0.5) / rows) * height),
  };
}

export const coordinateBombing = {
  name: 'CoordinateBombing',

  async execute(
    page: Page,
    target?: InteractiveElement,
    chaosManager?: ChaosTransactionManager<StressClickMetadata> | null,
  ): Promise<void> {
    const viewportSize = page.viewportSize();

    if (!viewportSize) {
      console.error('[StressScenario:CoordinateBombing] Unable to get viewport size');
      return;
    }

    const { width, height } = viewportSize;
    console.log(
      `[StressScenario:CoordinateBombing] Starting deterministic grid bombing on viewport ${width}x${height}`,
    );

    const manager = chaosManager ?? null;
    const metadata: StressClickMetadata = {
      velocity: 50,
      elementChain: [`viewport ${width}x${height}`],
      targetSelector: target?.selector ?? 'viewport',
      clickCount: BOMB_COUNT,
    };
    if (manager) {
      manager.startTransaction('viewport', 'STRESS_CLICK', metadata);
    }

    ActiveScenarioTracker.record(
      `Fire ${BOMB_COUNT} deterministic grid coordinate clicks across the ${width}x${height} viewport`,
    );

    let completed = 0;
    try {
      for (let i = 0; i < BOMB_COUNT; i++) {
        const { x, y } = gridCoordinate(i, BOMB_COUNT, width, height);

        try {
          await page.mouse.click(x, y);
          completed++;
          console.log(`[StressScenario:CoordinateBombing] Click ${i + 1}/${BOMB_COUNT} at (${x}, ${y})`);
        } catch (error) {
          if (error instanceof Error && isNonFatalNavigationError(error)) {
            console.log(
              `[StressScenario:CoordinateBombing] Ignored navigation error on click ${i + 1}: ${error.message}`,
            );
          } else if (error instanceof Error) {
            console.error(
              `[StressScenario:CoordinateBombing] Non-fatal error on click ${i + 1}: ${error.message}`,
            );
          }
        }

        await wait(50);
      }
    } finally {
      metadata.completed = completed;
      metadata.resultingState =
        completed === BOMB_COUNT ? 'all-completed' : completed === 0 ? 'error' : 'partial';
      manager?.endTransaction();
    }

    console.log(`[StressScenario:CoordinateBombing] Completed ${completed}/${BOMB_COUNT} coordinate clicks`);
  },
};

/**
 * Re-export of coordinateBombing for backwards compatibility
 * @deprecated Use coordinateBombing directly
 */
export const executeBombing = coordinateBombing;

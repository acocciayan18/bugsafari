/**
 * Coordinate Bombing Stress Scenario
 *
 * Fires BOMB_COUNT clicks at deterministic grid coordinates across the viewport
 * to hit empty space and potentially hidden/overlay elements. Coordinates are
 * derived from the iteration index (round-robin grid), so the same viewport +
 * count always produces the identical sequence — making any fault reproducible.
 *
 * Clicks are SEQUENTIAL by necessity: Playwright drives a single virtual mouse
 * pointer, so concurrent trusted coordinate clicks would corrupt each other. For
 * true zero-wait concurrency use the selector-based buttonSpammer/concurrentClicker.
 *
 * This stress test surfaces:
 * - Overlay/hit-testing edge cases (clicks landing on hidden/overlay elements)
 * - Desynchronization in coordinate-dependent logic
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, StressClickMetadata } from '../../chaos/index.js';
import { BOMB_COUNT, isNonFatalNavigationError, wait } from './utils.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { describeCoordinateBombing, resolveElementLabel } from '../../services/forensics/narration.js';
import { StressClickMetadataRecorder, type BurstOutcome } from '../../services/forensics/metadataRecorder.js';

/**
 * Deterministic grid coordinate for click `index` over a width×height viewport.
 * Lays the BOMB_COUNT points on the smallest near-square grid, centring each
 * click within its cell so the spread is stable and reproducible.
 */
export function gridCoordinate(index: number, count: number, width: number, height: number): { x: number; y: number } {
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

    const bombingSummary = describeCoordinateBombing(BOMB_COUNT, width, height);
    ActiveScenarioTracker.record(bombingSummary);
    // Push a re-expandable MACRO so regression replay reconstructs the exact grid
    // (the individual coordinate clicks aren't element-bound — a literal step-per-click
    // can't be replayed by selector, but {count,width,height} regenerates them exactly).
    ActionRecorder.recordStep({
      actionType: 'MACRO',
      humanIdentifier: target ? resolveElementLabel(target) : '',
      elementKind: 'page area',
      selector: target?.selector ?? 'viewport',
      url: page.url(),
      macro: {
        scenario: 'CoordinateBombing',
        params: { count: BOMB_COUNT, width, height },
        summary: bombingSummary,
      },
    });

    // Record through the shared recorder like the other STRESS_CLICK scenarios,
    // so the live transaction/telemetry observe one consistent metadata shape.
    const recorder = new StressClickMetadataRecorder(metadata);
    const points: string[] = [];
    const executionOrder: number[] = [];
    const start = Date.now();
    let completed = 0;
    try {
      for (let i = 0; i < BOMB_COUNT; i++) {
        const { x, y } = gridCoordinate(i, BOMB_COUNT, width, height);
        points.push(`(${x},${y})`);

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
        // Sequential (single virtual pointer) — settle order equals submission order.
        executionOrder.push(i);

        await wait(50);
      }
    } finally {
      const result: BurstOutcome = {
        selectors: points,
        attempted: BOMB_COUNT,
        completed,
        durationMs: Date.now() - start,
        executionOrder,
        resultingState:
          completed === BOMB_COUNT ? 'all-completed' : completed === 0 ? 'error' : 'partial',
      };
      recorder.record(result);
      manager?.endTransaction();
    }

    console.log(`[StressScenario:CoordinateBombing] Completed ${completed}/${BOMB_COUNT} coordinate clicks`);
  },
};

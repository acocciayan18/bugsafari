/**
 * Rapid Clicker Stress Scenarios
 *
 * This module consolidates all rapid clicking stress testing functionality:
 * - buttonSpammer: Rapid button clicking stress scenario
 * - coordinateBombing: Random coordinate clicking stress scenario
 * - burstClickElement: Concurrent burst clicking on single element
 * - concurrentEventSpam: Concurrent clicking on multiple targets
 * - executeSpam: Utility function for button spam
 *
 * All exports are consolidated here for clarity and maintainability.
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

// ============================================================================
// Configuration Constants
// ============================================================================

const CLICK_COUNT = 15;
const CLICK_DELAY_MS = 50;
const BOMB_COUNT = 10;
const DEFAULT_MAX_TARGETS = 12;
const DEFAULT_BURST_COUNT = 50;
const DEFAULT_BURST_DURATION_MS = 1000;

// ============================================================================
// Error Handling Utilities
// ============================================================================

const ERROR_MESSAGES = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  CONTEXT_DESTROYED: 'context destroyed',
} satisfies Record<string, string>;

/**
 * Checks if an error is a non-fatal navigation error that should be ignored.
 */
function isNonFatalNavigationError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return Object.values(ERROR_MESSAGES).some((fatalMessage) =>
    message.includes(fatalMessage.toLowerCase())
  );
}

/**
 * Checks if an error indicates the element is obscured or detached.
 */
function isObscuredOrDetached(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Node is detached from document') ||
    message.includes('is not clickable') ||
    message.includes('element is not visible') ||
    message.includes('obscured')
  );
}

/**
 * Generates a random integer between min and max (inclusive).
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Simple wait utility.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Button Spammer Stress Scenario
// ============================================================================

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

// ============================================================================
// Coordinate Bombing Stress Scenario
// ============================================================================

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

// ============================================================================
// Burst Click Utilities
// ============================================================================

/**
 * Result of a burst click operation.
 */
export interface BurstClickResult {
  attempted: number;
  completed: number;
}

/**
 * Performs burst clicking on a single element.
 *
 * @param page Playwright Page object
 * @param selector CSS selector to click
 * @param clickCount Number of clicks to perform (default: 50)
 * @param durationMs Duration over which to spread clicks in ms (default: 1000)
 * @returns Promise resolving to BurstClickResult
 */
export async function burstClickElement(
  page: Page,
  selector: string,
  clickCount = DEFAULT_BURST_COUNT,
  durationMs = DEFAULT_BURST_DURATION_MS,
): Promise<BurstClickResult> {
  const locator = page.locator(selector).first();
  const tasks: Promise<boolean>[] = [];

  for (let index = 0; index < clickCount; index += 1) {
    const delayMs = Math.floor((durationMs / Math.max(1, clickCount - 1)) * index);

    tasks.push(
      new Promise<boolean>((resolve) => {
        setTimeout(() => {
          locator
            .click({ force: true, noWaitAfter: true, timeout: Math.max(500, durationMs) })
            .then(() => resolve(true))
            .catch(() => resolve(false));
        }, delayMs);
      }),
    );
  }

  const results = await Promise.all(tasks);

  return {
    attempted: clickCount,
    completed: results.filter(Boolean).length,
  };
}

/**
 * Performs concurrent event spam on multiple targets.
 *
 * Clicks on all visible button-like elements concurrently.
 *
 * @param page Playwright Page object
 * @param maxTargets Maximum number of targets to click (default: 12)
 * @returns Promise resolving to BurstClickResult
 */
export async function concurrentEventSpam(
  page: Page,
  maxTargets = DEFAULT_MAX_TARGETS,
): Promise<BurstClickResult> {
  const locators = await page
    .locator('button, a[href], input[type="submit"], input[type="button"], [role="button"]')
    .all();
  const visibleLocators = locators.slice(0, maxTargets);

  const results = await Promise.all(
    visibleLocators.map((locator) =>
      locator
        .click({ force: true, noWaitAfter: true, timeout: 1000 })
        .then(() => true)
        .catch(() => false),
    ),
  );

  return {
    attempted: visibleLocators.length,
    completed: results.filter(Boolean).length,
  };
}

/**
 * Executes spam clicks on a target element.
 * This wraps the buttonSpammer StressScenario for direct function calls.
 *
 * @param page Playwright Page object
 * @param selector CSS selector to click
 */
export async function executeSpam(page: Page, selector: string): Promise<void> {
  await buttonSpammer.execute(page, { selector } as InteractiveElement);
}

/**
 * Re-export of coordinateBombing for backwards compatibility
 * @deprecated Use coordinateBombing directly
 */
export { coordinateBombing as executeBombing };

// ============================================================================
// Interaction Simulator Class (Consolidated)
// ============================================================================

/**
 * Interaction Simulator for executing rapid click operations.
 *
 * This class provides methods for button spamming and concurrent clicking,
 * wrapping the consolidated stress scenario functions.
 */
export class InteractionSimulator {
  /**
   * Performs rapid button spamming on a selector.
   *
   * @param page Playwright Page object
   * @param selector CSS selector to spam clicks on
   */
  public async buttonSpammer(page: Page, selector: string): Promise<void> {
    const durationMs = 300;
    const start = Date.now();

    while (Date.now() - start < durationMs) {
      await page
        .evaluate((sel) => {
          const node = document.querySelector(sel) as HTMLElement | null;
          if (node) {
            node.click();
          }
        }, selector)
        .catch(() => undefined);
      await wait(10);
    }
  }

  /**
   * Performs concurrent clicking on multiple selectors.
   *
   * @param page Playwright Page object
   * @param selectors Array of CSS selectors to click concurrently
   */
  public async concurrentClicker(page: Page, selectors: string[]): Promise<void> {
    const targetSelectors = selectors.slice(0, 5);

    const clickTasks = targetSelectors.map(async (selector: string) => {
      try {
        await page.click(selector, { timeout: 1000 });
      } catch (error) {
        if (isObscuredOrDetached(error)) {
          return;
        }
        return;
      }
    });
    await Promise.all(clickTasks);
  }
}

// ============================================================================
// Type Exports (for backwards compatibility)
// ============================================================================

export type { StressScenario } from './types.js';
export type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';

/**
 * Burst Clicker Utilities
 *
 * Provides functions for:
 * - burstClickElement: Burst clicking on a single element
 * - concurrentEventSpam: Concurrent clicking on multiple targets
 * - executeSpam: Utility wrapper for button spam
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import {
  DEFAULT_BURST_COUNT,
  DEFAULT_BURST_DURATION_MS,
  DEFAULT_MAX_TARGETS,
  isObscuredOrDetached,
} from './utils.js';
import { buttonSpammer } from './buttonSpammer.js';

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

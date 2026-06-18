/**
 * Interaction Simulator
 *
 * Provides methods for simulating rapid click operations:
 * - buttonSpammer: Rapid button spamming on a selector
 * - concurrentClicker: Concurrent clicking on multiple selectors
 */

import type { Page } from 'playwright';
import { isObscuredOrDetached, wait } from './utils.js';

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

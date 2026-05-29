import type { Page } from 'playwright';
import { BoundingBoxHighlighter } from '../../infrastructure/playwright/BoundingBoxHighlighter.js';

export class InteractionSimulator {
  private readonly highlighter = new BoundingBoxHighlighter();

  public async buttonSpammer(page: Page, selector: string): Promise<void> {
    // Highlight the element being clicked
    await this.highlighter.flashHighlight(page, selector);

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

  public async concurrentClicker(page: Page, selectors: string[]): Promise<void> {
    const targetSelectors = selectors.slice(0, 5);

    // Highlight all elements before clicking
    await this.highlighter.highlightElements(page, targetSelectors, 600);

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

  /**
   * Gets the highlighter instance for custom highlighting
   */
  public getHighlighter(): BoundingBoxHighlighter {
    return this.highlighter;
  }
}

function isObscuredOrDetached(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Node is detached from document') ||
    message.includes('is not clickable') ||
    message.includes('element is not visible') ||
    message.includes('obscured')
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

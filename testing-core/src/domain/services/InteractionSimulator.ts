import type { Page } from 'playwright';

export class InteractionSimulator {
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

import type { Page } from 'playwright';

export interface BurstClickResult {
  attempted: number;
  completed: number;
}

export async function burstClickElement(
  page: Page,
  selector: string,
  clickCount = 50,
  durationMs = 1000,
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

export async function concurrentEventSpam(page: Page, maxTargets = 12): Promise<BurstClickResult> {
  const locators = await page.locator('button, a[href], input[type="submit"], input[type="button"], [role="button"]').all();
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

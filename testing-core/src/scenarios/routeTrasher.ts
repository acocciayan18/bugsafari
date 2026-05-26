import type { Page } from 'playwright';

export interface RouteTrashResult {
  attempted: number;
  completed: number;
}

export async function trashRoutes(page: Page, repetitions = 2): Promise<RouteTrashResult> {
  let attempted = 0;
  let completed = 0;

  for (let index = 0; index < repetitions; index += 1) {
    attempted += 3;

    if (await safeNavigation(() => page.goBack({ waitUntil: 'domcontentloaded', timeout: 1200 }))) {
      completed += 1;
    }

    if (await safeNavigation(() => page.goForward({ waitUntil: 'domcontentloaded', timeout: 1200 }))) {
      completed += 1;
    }

    if (await safeNavigation(() => page.reload({ waitUntil: 'domcontentloaded', timeout: 1600 }))) {
      completed += 1;
    }
  }

  return { attempted, completed };
}

async function safeNavigation(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}

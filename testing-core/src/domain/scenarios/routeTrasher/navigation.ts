import type { Page } from 'playwright';
import { wait, isNonFatalNavigationError } from '../rapidClicker/utils.js';

// SPA-safe settle window: wait for async rendering to finish after a navigation
// before the next action fires, so we never drive the client router mid-render.
const SETTLE_TIMEOUT_MS = 2000;
const STABILIZE_MS = 50;

// Route-specific non-fatal signatures beyond the shared rapid-clicker table.
// These fire when navigations interrupt one another and must be ignored so the
// burst loop keeps running instead of aborting.
const EXTRA_IGNORABLE = ['navigation', 'context destroyed'] as const;

/**
 * True when an error is a benign navigation/teardown race that should be ignored
 * during route trashing. Delegates to the shared classifier, then adds the two
 * route-specific signatures the old local table carried.
 */
export function isIgnorableNavError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isNonFatalNavigationError(error)) return true;
  const message = error.message.toLowerCase();
  return EXTRA_IGNORABLE.some((signature) => message.includes(signature));
}

/**
 * Wait for the SPA to finish asynchronous rendering after a navigation. Reaching
 * `networkidle` is best-effort (streaming/long-poll pages never do), followed by
 * a short stabilization so the router commits before the next action.
 */
export async function settleAfterNavigation(page: Page, timeout: number = SETTLE_TIMEOUT_MS): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Expected for long-polling / streaming connections — proceed anyway.
  }
  await wait(STABILIZE_MS);
}

/**
 * Execute a history navigation and settle for SPA render. Returns whether the
 * navigation ran; benign navigation races resolve to `false` rather than throw.
 */
export async function safeNavigation(
  page: Page,
  action: 'goBack' | 'goForward',
  timeout: number = 1200,
): Promise<boolean> {
  try {
    await page[action]({ waitUntil: 'domcontentloaded', timeout });
    await settleAfterNavigation(page);
    return true;
  } catch (error) {
    if (!isIgnorableNavError(error)) {
      console.error(
        `[StressScenario:RouteTrasher] Navigation error on ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return false;
  }
}

/**
 * Navigate to an absolute URL and settle for SPA render. Returns whether the
 * navigation ran; benign navigation races resolve to `false` rather than throw.
 */
export async function safeGoto(page: Page, url: string, timeout: number = 1000): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await settleAfterNavigation(page);
    return true;
  } catch (error) {
    if (!isIgnorableNavError(error)) {
      console.error(
        `[StressScenario:RouteTrasher] Navigation error on goto ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return false;
  }
}

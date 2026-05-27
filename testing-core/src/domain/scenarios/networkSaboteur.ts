import type { Page, Route, Request } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

type SabotageMode = 'Delayed' | 'Aborted';

const NON_FATAL_ERRORS = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  ROUTE_NOT_FOUND: 'route is not found',
  CONTEXT_CLOSED: 'browser context closed',
  PAGE_CLOSED: 'page has been closed',
} satisfies Record<string, string>;

function isNonFatalError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return Object.values(NON_FATAL_ERRORS).some((signature) => msg.includes(signature.toLowerCase()));
}

function randomDelayMs(): number {
  return 10_000 + Math.floor(Math.random() * 5_001); // 10000-15000
}

function chooseMode(): SabotageMode {
  return Math.random() < 0.5 ? 'Delayed' : 'Aborted';
}

async function safeAbort(route: Route): Promise<void> {
  try {
    await route.abort();
  } catch (error) {
    if (error instanceof Error && isNonFatalError(error)) return;
    throw error;
  }
}

async function safeContinue(route: Route): Promise<void> {
  try {
    await route.continue();
  } catch (error) {
    if (error instanceof Error && isNonFatalError(error)) return;
    throw error;
  }
}

/**
 * Network Saboteur scenario:
 * - Intercepts requests with page.route()
 * - Randomly delays (10-15s) or aborts one request
 * - Checks for "System Locked" / frozen UI signals
 * - Emits ACTION telemetry
 */
export const networkSaboteur: StressScenario = {
  name: 'NetworkSaboteur',

  async execute(page: Page, _target?: InteractiveElement): Promise<void> {
    const mode = chooseMode();
    const pattern = '**/*';
    let sabotaged = false;
    let sabotagedUrl = 'unknown-url';

    const handler = async (route: Route, request: Request): Promise<void> => {
      if (sabotaged) {
        await safeContinue(route);
        return;
      }

      // Prefer API/XHR/fetch/doc requests as candidate network calls
      const type = request.resourceType();
      if (!['xhr', 'fetch', 'document'].includes(type)) {
        await safeContinue(route);
        return;
      }

      sabotaged = true;
      sabotagedUrl = request.url();

      if (mode === 'Delayed') {
        const delay = randomDelayMs();
        await new Promise((resolve) => setTimeout(resolve, delay));
        await safeContinue(route);

        console.log(
          `[Telemetry:ACTION] 📡 Network Saboteur: Intentionally Delayed API call to ${sabotagedUrl} to test error resilience.`
        );
        return;
      }

      await safeAbort(route);
      console.log(
        `[Telemetry:ACTION] 📡 Network Saboteur: Intentionally Aborted API call to ${sabotagedUrl} to test error resilience.`
      );
    };

    try {
      await page.route(pattern, handler);

      // Trigger at least one request to exercise sabotage
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (error) {
        if (!(error instanceof Error) || !isNonFatalError(error)) {
          throw error;
        }
      }

      // Small settling window for UI state after sabotage
      await page.waitForTimeout(1200).catch(() => undefined);

      const locked = await page
        .evaluate(() => {
          const bodyText = document.body?.innerText?.toLowerCase() ?? '';
          if (bodyText.includes('system locked')) return true;

          // Simple frozen UI heuristic: loading artifacts still present
          const stuckSelectors = [
            '[aria-busy="true"]',
            '.loading',
            '.spinner',
            '.infinite-spinner',
            '[data-loading="true"]',
          ];
          return stuckSelectors.some((sel) => document.querySelector(sel));
        })
        .catch(() => false);

      if (locked) {
        console.log('[StressScenario:NetworkSaboteur] UI appears "System Locked" (frozen) after sabotage');
      }
    } catch (error) {
      if (error instanceof Error && isNonFatalError(error)) {
        console.log(`[StressScenario:NetworkSaboteur] Non-fatal error ignored: ${error.message}`);
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[StressScenario:NetworkSaboteur] Failed during network sabotage: ${message}`);
      }
    } finally {
      try {
        await page.unroute(pattern, handler);
      } catch (error) {
        if (!(error instanceof Error) || !isNonFatalError(error)) {
          console.error(
            `[StressScenario:NetworkSaboteur] Failed to clean up route handler: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }
    }
  },
};

export type NetworkSaboteur = typeof networkSaboteur;

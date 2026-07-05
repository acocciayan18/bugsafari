import type { Page, Response, ConsoleMessage } from 'playwright';

/**
 * Shared response/console/pageerror capture for the forensic pipelines.
 *
 * Both {@link fuzzForensics} (payload injection) and {@link navForensics}
 * (navigation) need the exact same "attribute backend calls + app errors to this
 * step" listener set. This is the single source for that logic and the two
 * anomaly shapes so they can never drift apart.
 */

/** A single API response (xhr/fetch) observed during a step. */
export interface ApiResponseTrace {
  readonly url: string;
  readonly status: number;
  readonly method: string;
}

/** A console error/warning or uncaught page error observed during a step. */
export interface ConsoleAnomaly {
  readonly type: 'error' | 'warning' | 'pageerror';
  readonly text: string;
}

/** Live collectors plus a detach handle; call `detach()` in a `finally`. */
export interface AnomalyCollectors {
  readonly apiResponses: ApiResponseTrace[];
  readonly consoleAnomalies: ConsoleAnomaly[];
  detach(): void;
}

// Per-step caps so a pathological page (response floods, console spam) cannot
// grow a single snapshot without bound.
const MAX_RESPONSES_PER_STEP = 50;
const MAX_ANOMALIES_PER_STEP = 50;

/**
 * Attach response/console/pageerror listeners that collect, capped, into two
 * live arrays. Filters to backend xhr/fetch responses and error/warning console
 * output — static assets and the document load itself are noise. Never throws.
 */
export function attachAnomalyListeners(
  page: Page,
  maxResponses: number = MAX_RESPONSES_PER_STEP,
  maxAnomalies: number = MAX_ANOMALIES_PER_STEP,
): AnomalyCollectors {
  const apiResponses: ApiResponseTrace[] = [];
  const consoleAnomalies: ConsoleAnomaly[] = [];

  const onResponse = (response: Response): void => {
    if (apiResponses.length >= maxResponses) return;
    try {
      const request = response.request();
      const resourceType = request.resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') {
        apiResponses.push({ url: response.url(), status: response.status(), method: request.method() });
      }
    } catch {
      // Request/response may be torn down mid-navigation — ignore.
    }
  };

  const onConsole = (msg: ConsoleMessage): void => {
    if (consoleAnomalies.length >= maxAnomalies) return;
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleAnomalies.push({ type, text: msg.text().slice(0, 2000) });
    }
  };

  const onPageError = (error: Error): void => {
    if (consoleAnomalies.length >= maxAnomalies) return;
    consoleAnomalies.push({ type: 'pageerror', text: (error.message || String(error)).slice(0, 2000) });
  };

  page.on('response', onResponse);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    apiResponses,
    consoleAnomalies,
    detach(): void {
      page.off('response', onResponse);
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    },
  };
}

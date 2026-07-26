import type { Page, Route, Request } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { TelemetryEvent, TelemetryMeta, TelemetryType } from '../../../../shared/types.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import { describeNetworkSabotage } from '../services/forensics/narration.js';
import { FREEZE_SELECTORS, INPUT_BLOCK_SELECTORS } from '../../bugs/knowledgeBase/index.js';
import { scenarioRandom } from './seededRandom.js';

type SabotageMode = 'Delayed' | 'Aborted' | 'Mutated';

/**
 * Configuration for interception scope narrowing.
 * Targets API requests while excluding static visual assets.
 */
interface InterceptionConfig {
  pattern: string;
  additionalPatterns: string[];
  targetResourceTypes: Array<'xhr' | 'fetch' | 'document'>;
  excludeExtensions: string[];
  interceptionTimeoutMs: number;
}

const DEFAULT_CONFIG: InterceptionConfig = {
  // Primary pattern: REST API endpoints
  pattern: '**/api/**',
  // Additional patterns for GraphQL, versioned APIs, and other common API patterns
  additionalPatterns: [
    '**/*.api',
    '**/graphql',
    '**/v[0-9]/**',
    '**/v[0-9][0-9]/**',
    '**/rest/**',
    '**/data/**',
  ],
  // Only intercept XHR and fetch requests
  targetResourceTypes: ['xhr', 'fetch'],
  // Static visual assets to exclude - bypass node event loop entirely
  excludeExtensions: [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.css', '.scss', '.less',
    '.js', '.mjs',
    '.map',
  ],
  // Timeout for waiting for API request
  interceptionTimeoutMs: 5000,
};

// Freeze-detection selectors (STUCK_SELECTORS) and input-block selectors are
// sourced from the centralized knowledge base (knowledgeBase/signalPatterns.ts)
// so they stay consistent across the platform.

const NON_FATAL_ERRORS = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  ROUTE_NOT_FOUND: 'route is not found',
  CONTEXT_CLOSED: 'browser context closed',
  PAGE_CLOSED: 'page has been closed',
  ROUTE_HANDLED: 'route is already handled',
} satisfies Record<string, string>;

function isNonFatalError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return Object.values(NON_FATAL_ERRORS).some((signature) => msg.includes(signature.toLowerCase()));
}

function randomDelayMs(): number {
  return 10_000 + Math.floor(scenarioRandom() * 5_001); // 10000-15000ms
}

function chooseMode(): SabotageMode {
  const r = scenarioRandom();
  if (r < 0.34) return 'Delayed';
  if (r < 0.67) return 'Aborted';
  return 'Mutated';
}

/**
 * Corrupt a single JSON value to probe server/client type-tolerance:
 * numbers become out-of-range, strings gain an injection/oversize suffix,
 * everything else collapses to null.
 */
function corruptValue(value: unknown): unknown {
  if (typeof value === 'number') return Number.MAX_SAFE_INTEGER * -1;
  if (typeof value === 'string') return `${value}"><script>chaos</script>${'9'.repeat(256)}`;
  if (typeof value === 'boolean') return !value;
  return null;
}

/**
 * Mutate an outgoing request body. Parses JSON and corrupts each top-level
 * field (type confusion + boundary values); on non-JSON bodies appends a
 * null byte, an injection marker, and an oversize tail. Never throws.
 */
function mutateBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        parsed[key] = corruptValue(parsed[key]);
      }
      return JSON.stringify(parsed);
    }
  } catch {
    // fall through to raw-body mutation
  }
  return `${body}\x00<script>chaos</script>${'9'.repeat(512)}`;
}

// Truncated/malformed JSON served when a mutated request carries no body — tests
// client-side response parsing resilience (unterminated object, null id).
const CORRUPT_RESPONSE_BODY = '{"data":[{"id":null,"corrupted":true,';

/**
 * Mutate a sabotaged request in place. When the request carries a body the
 * outgoing payload is corrupted via {@link mutateBody}; bodiless requests
 * (GET/HEAD) instead receive a malformed response so the client's parse path is
 * exercised. Returns which surface was mutated for telemetry.
 */
async function safeMutate(route: Route, request: Request): Promise<'request' | 'response' | 'skipped'> {
  try {
    const postData = request.postData();
    if (postData) {
      await route.continue({ postData: mutateBody(postData) });
      return 'request';
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: CORRUPT_RESPONSE_BODY,
    });
    return 'response';
  } catch (error) {
    if (error instanceof Error && isNonFatalError(error)) return 'skipped';
    throw error;
  }
}

/**
 * Check if request should be excluded based on URL extension (static assets).
 * Pre-filters before route handler for maximum performance.
 */
function shouldExcludeRequest(url: string, excludeExtensions: string[]): boolean {
  const lowerUrl = url.toLowerCase();
  return excludeExtensions.some((ext) => lowerUrl.endsWith(ext) || lowerUrl.includes(`${ext}?`));
}

/**
 * Push the sabotage into the rolling action buffer (structured reproduction
 * playbook). Mode rides in `humanIdentifier`, target URL in `value`, so the
 * narrator renders a faithful network step. Never throws.
 */
function recordSabotage(mode: SabotageMode, targetUrl: string, pageUrl: string): void {
  try {
    ActionRecorder.recordStep({
      actionType: 'NETWORK',
      humanIdentifier: mode,
      elementKind: 'network request',
      value: targetUrl,
      selector: 'network',
      url: pageUrl,
    });
  } catch {
    // Buffer recording is best-effort forensics — never break sabotage flow.
  }
}

/**
 * Build telemetry event for NETWORK type.
 */
function buildNetworkTelemetryEvent(
  telemetry: TelemetryGateway,
  mode: SabotageMode,
  url: string,
  message: string,
): void {
  const event: TelemetryEvent = {
    timestamp: new Date().toISOString(),
    type: 'NETWORK' as TelemetryType,
    meta: {
      url,
      message,
      statusCode: mode === 'Aborted' ? 0 : undefined,
    },
  };
  telemetry.emitTelemetry(event);
}

/**
 * Emit freeze detection telemetry event.
 */
function emitFreezeTelemetry(telemetry: TelemetryGateway | undefined, isFrozen: boolean, selector: string): void {
  if (telemetry) {
    const event: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      type: 'NETWORK' as TelemetryType,
      meta: {
        message: isFrozen
          ? `UI appears frozen - stuck selector: ${selector}`
          : 'UI appears responsive',
        selector: selector,
      },
    };
    telemetry.emitTelemetry(event);
  }
}

/**
 * Check for freeze state using expanded stuckSelectors.
 * Returns the triggering selector if frozen, otherwise empty string.
 */
async function checkForFreezeState(page: Page): Promise<string> {
  try {
    // Selectors are passed as an argument — Node module closures are NOT visible
    // inside the browser context, so referencing them directly would silently
    // no-op (a latent bug the previous inline reference concealed).
    return await page.evaluate((selectors) => {
      const bodyText = document.body?.innerText?.toLowerCase() ?? '';
      if (bodyText.includes('system locked')) return 'system-locked-text';

      for (const sel of selectors) {
        if (document.querySelector(sel)) {
          return sel;
        }
      }
      return '';
    }, [...FREEZE_SELECTORS]);
  } catch {
    return '';
  }
}

/**
 * Check if input fields are stuck with aria-disabled.
 * Returns true if multiple input fields are disabled (indicating stuck state).
 */
async function checkInputFieldsDisabled(page: Page): Promise<boolean> {
  try {
    return await page.evaluate((selectors) => {
      let disabledCount = 0;
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        disabledCount += elements.length;
      }
      // Consider stuck if 2+ inputs are disabled
      return disabledCount >= 2;
    }, [...INPUT_BLOCK_SELECTORS]);
  } catch {
    return false;
  }
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
 * Network Saboteur scenario.
 * Narrows interception scope to API endpoints only.
 * Pre-filters static assets to bypass node event loop.
 * Randomly delays or aborts one request.
 * Hooks live transaction state instead of triggering page reload.
 * Checks for System Locked or frozen UI signals.
 * Emits structured NETWORK telemetry events.
 */
export const networkSaboteur: StressScenario = {
  name: 'NetworkSaboteur',

  async execute(page: Page, _target?: InteractiveElement, _telemetry?: TelemetryGateway): Promise<void> {
    const config = DEFAULT_CONFIG;
    const mode = chooseMode();
    let sabotaged = false;
    let sabotagedUrl = 'unknown-url';

    ActiveScenarioTracker.record(describeNetworkSabotage(mode));

    const handler = async (route: Route, request: Request): Promise<void> => {
      if (sabotaged) {
        // Already sabotaged a request, let subsequent requests pass through
        return;
      }

      const requestUrl = request.url();
      const resourceType = request.resourceType();

      // Pre-filter: Skip static assets BEFORE route handler processing overhead
      if (shouldExcludeRequest(requestUrl, config.excludeExtensions)) {
        await safeContinue(route);
        return;
      }

      // Only sabotage target resource types (xhr/fetch), NOT document
      if (!config.targetResourceTypes.includes(resourceType as 'xhr' | 'fetch')) {
        await safeContinue(route);
        return;
      }

      // Mark as sabotaged - capture first API request only
      sabotaged = true;
      sabotagedUrl = requestUrl;

      // Record the sabotage to the rolling reproduction buffer so it lands in
      // the idle-fallback playbook even when no scenario window is flushed.
      recordSabotage(mode, sabotagedUrl, page.url());

      const telemetry = _telemetry;

      if (mode === 'Delayed') {
        const delay = randomDelayMs();
        await new Promise((resolve) => setTimeout(resolve, delay));
        await safeContinue(route);

        if (telemetry) {
          buildNetworkTelemetryEvent(
            telemetry,
            'Delayed',
            sabotagedUrl,
            `Network Saboteur: Intentionally Delayed API call to ${sabotagedUrl} to test error resilience.`,
          );
        }
        return;
      }

      if (mode === 'Mutated') {
        const surface = await safeMutate(route, request);

        if (telemetry) {
          buildNetworkTelemetryEvent(
            telemetry,
            'Mutated',
            sabotagedUrl,
            `Network Saboteur: Mutated ${surface} payload for ${sabotagedUrl} to test malformed-data resilience.`,
          );
        }
        return;
      }

      // Aborted mode
      await safeAbort(route);

      if (telemetry) {
        buildNetworkTelemetryEvent(
          telemetry,
          'Aborted',
          sabotagedUrl,
          `Network Saboteur: Intentionally Aborted API call to ${sabotagedUrl} to test error resilience.`,
        );
      }
    };

    try {
      // Set up interception with primary pattern
      await page.route(config.pattern, handler);

      // Register additional patterns for broader API coverage
      for (const additionalPattern of config.additionalPatterns) {
        // Use a separate handler wrapper to track the same sabotage state
        // This prevents duplicate interception while catching more API patterns
        await page.route(additionalPattern, async (route: Route, request: Request): Promise<void> => {
          // Delegate to main handler logic - it checks sabotaged flag
          await handler(route, request);
        }).catch(() => {
          // Silently ignore patterns that don't match anything
          // This is expected for patterns that don't exist in the app
        });
      }

      // Hook live transaction state: wait briefly for exploratory engine's action
      // (button click, form submission, etc.) to trigger an API request
      // instead of triggering our own page.reload() which is an anti-pattern
      await page.waitForTimeout(config.interceptionTimeoutMs).catch(() => undefined);

      // Small settling window for UI state after sabotage
      await page.waitForTimeout(1200).catch(() => undefined);

      // Check for freeze state using expanded sticky selectors
      const frozenSelector = await checkForFreezeState(page);

      // Check for aria-disabled input fields (multi-iteration check for stuck state)
      const inputsDisabled = await checkInputFieldsDisabled(page);

      const isFrozen = frozenSelector !== '' || inputsDisabled;

      // Emit freeze detection telemetry
      const telemetry = _telemetry;
      if (telemetry) {
        emitFreezeTelemetry(telemetry, isFrozen, frozenSelector || (inputsDisabled ? 'aria-disabled-inputs' : ''));
      }
    } catch (error) {
      // Emit error telemetry if available
      const telemetry = _telemetry;
      if (telemetry && error instanceof Error) {
        const event: TelemetryEvent = {
          timestamp: new Date().toISOString(),
          type: 'NETWORK' as TelemetryType,
          meta: {
            message: isNonFatalError(error)
              ? `Non-fatal error ignored: ${error.message}`
              : `Failed during network sabotage: ${error.message}`,
          },
        };
        telemetry.emitTelemetry(event);
      } else if (error instanceof Error && !isNonFatalError(error)) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Fallback to console for critical errors if no telemetry
        console.error(`[StressScenario:NetworkSaboteur] Failed during network sabotage: ${message}`);
      }
    } finally {
      // Clean up route handlers to prevent leaked interceptors
      try {
        await page.unroute(config.pattern, handler);
      } catch (error) {
        // Emit cleanup error telemetry if available
        const telemetry = _telemetry;
        if (telemetry && error instanceof Error && !isNonFatalError(error)) {
          const event: TelemetryEvent = {
            timestamp: new Date().toISOString(),
            type: 'NETWORK' as TelemetryType,
            meta: {
              message: `Failed to clean up route handler: ${error.message}`,
            },
          };
          telemetry.emitTelemetry(event);
        } else if (!(error instanceof Error) || !isNonFatalError(error)) {
          console.error(
            `[StressScenario:NetworkSaboteur] Failed to clean up route handler: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }

      // Clean up additional patterns
      for (const additionalPattern of config.additionalPatterns) {
        try {
          // Note: We use the same handler reference for additional patterns
          // since they share the sabotage state
          await page.unroute(additionalPattern);
        } catch {
          // Silently ignore cleanup errors for additional patterns
        }
      }
    }
  },
};

export type NetworkSaboteur = typeof networkSaboteur;

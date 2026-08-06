import type { Page, Route, Request } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { TelemetryEvent, TelemetryMeta, TelemetryType } from '../../../../shared/types.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import { ChaosInjectionRegistry } from '../../infrastructure/monitoring/chaosInjectionRegistry.js';
import { describeNetworkSabotage, resolveControlName } from '../services/forensics/narration.js';
import { FREEZE_SELECTORS, INPUT_BLOCK_SELECTORS } from '../../bugs/knowledgeBase/index.js';
import { isBackgroundTelemetryUrl } from '../../domain/heuristics/ApiHangFinder.js';
import { scenarioRandom } from './seededRandom.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StressScenario:NetworkSaboteur]');

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
  // Standalone-path wait for the page's own traffic. The engine path arms around
  // a real interaction instead and never uses this.
  interceptionTimeoutMs: 5000,
};

// Settle window before the freeze probe, so a sabotaged request has time to
// leave the UI in whatever state it ends up in.
const SETTLE_AFTER_SABOTAGE_MS = 1200;

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
    // Mark the endpoint as chaos-injected so any failure it produces is routed to
    // Findings (the app's handling of an injected fault is what is under test)
    // instead of being filtered out as environment noise.
    ChaosInjectionRegistry.mark(targetUrl, mode);
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
          ? `UI appears frozen — blocking indicator ${resolveControlName({ label: selector, selector })} is still present`
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

/** Live interception window returned by {@link armNetworkSabotage}. */
export interface ArmedSabotage {
  readonly mode: SabotageMode;
  /** Whether a real API request was intercepted while the window was open. */
  wasSabotaged(): boolean;
  /** Tear down the interceptors and run the freeze / input-block probe. */
  disarm(): Promise<void>;
}

/**
 * Arm the API interceptors and hand back a disposer.
 *
 * The caller drives a real interaction while the window is open, so the request
 * that gets delayed/aborted/mutated is one the APPLICATION issued in response to
 * a user action. The previous arm-and-idle flow slept 5s with nothing in flight
 * (the engine loop is a single await chain), so it could only ever catch
 * incidental background traffic and usually sabotaged nothing at all.
 */
export async function armNetworkSabotage(
  page: Page,
  telemetry?: TelemetryGateway,
): Promise<ArmedSabotage> {
  const config = DEFAULT_CONFIG;
  const mode = chooseMode();
  let sabotaged = false;
  let sabotagedUrl = 'unknown-url';

  ActiveScenarioTracker.record(describeNetworkSabotage(mode));

  const handler = async (route: Route, request: Request): Promise<void> => {
    if (sabotaged) {
      // One request per window. Subsequent traffic MUST still be resolved —
      // returning without handling the route leaves it unanswered, which would
      // stall every follow-up API call for as long as the window is armed.
      await safeContinue(route);
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

    // Never sabotage a fire-and-forget telemetry/analytics/beacon — failing one produces a
    // meaningless finding, not a real resilience defect in the app's own data flow.
    if (isBackgroundTelemetryUrl(requestUrl)) {
      await safeContinue(route);
      return;
    }

    // Mark as sabotaged - capture first API request only
    sabotaged = true;
    sabotagedUrl = requestUrl;

    // Record the sabotage to the rolling reproduction buffer so it lands in
    // the idle-fallback playbook even when no scenario window is flushed.
    recordSabotage(mode, sabotagedUrl, page.url());

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
    await page.route(config.pattern, handler);
    // Additional patterns share the same handler (and its one-shot flag) so a
    // GraphQL/versioned endpoint is covered without double-sabotaging.
    for (const additionalPattern of config.additionalPatterns) {
      await page.route(additionalPattern, handler).catch(() => undefined);
    }
  } catch (error) {
    reportSabotageError(telemetry, error, 'Failed to arm network sabotage');
  }

  return {
    mode,
    wasSabotaged: () => sabotaged,
    async disarm(): Promise<void> {
      try {
        await page.unroute(config.pattern, handler);
        for (const additionalPattern of config.additionalPatterns) {
          await page.unroute(additionalPattern, handler).catch(() => undefined);
        }
      } catch (error) {
        reportSabotageError(telemetry, error, 'Failed to clean up route handler');
      }

      // A freeze verdict is only meaningful once a fault was actually injected —
      // probing an untouched page produced a steady stream of "UI appears
      // responsive" noise every cadence step.
      if (!sabotaged) return;

      await page.waitForTimeout(SETTLE_AFTER_SABOTAGE_MS).catch(() => undefined);
      const frozenSelector = await checkForFreezeState(page);
      const inputsDisabled = await checkInputFieldsDisabled(page);
      emitFreezeTelemetry(
        telemetry,
        frozenSelector !== '' || inputsDisabled,
        frozenSelector || (inputsDisabled ? 'aria-disabled-inputs' : ''),
      );
    },
  };
}

/** Route/teardown failures are forensics, never fatal to the run. */
function reportSabotageError(telemetry: TelemetryGateway | undefined, error: unknown, context: string): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const nonFatal = error instanceof Error && isNonFatalError(error);
  if (telemetry) {
    const event: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      type: 'NETWORK' as TelemetryType,
      meta: { message: nonFatal ? `Non-fatal error ignored: ${message}` : `${context}: ${message}` },
    };
    telemetry.emitTelemetry(event);
    return;
  }
  if (!nonFatal) obsLog.error(`[StressScenario:NetworkSaboteur] ${context}: ${message}`);
}

/**
 * Network Saboteur scenario — standalone form used by the by-name scenario map.
 * Arms the interceptors, waits for the page's own traffic, then disarms. The
 * engine loop uses {@link armNetworkSabotage} directly so the window spans a real
 * interaction instead of an idle wait.
 */
export const networkSaboteur: StressScenario = {
  name: 'NetworkSaboteur',

  async execute(page: Page, _target?: InteractiveElement, telemetry?: TelemetryGateway): Promise<void> {
    const armed = await armNetworkSabotage(page, telemetry);
    try {
      await page.waitForTimeout(DEFAULT_CONFIG.interceptionTimeoutMs).catch(() => undefined);
    } finally {
      await armed.disarm();
    }
  },
};

export type NetworkSaboteur = typeof networkSaboteur;

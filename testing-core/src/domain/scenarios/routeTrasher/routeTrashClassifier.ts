// ═══════════════════════════════════════════════════════════════
// routeTrasher/routeTrashClassifier.ts — CENTRALIZED SEVERITY CLASSIFICATION
// ═══════════════════════════════════════════════════════════════
// Pure, deterministic, side-effect-free. Single source of truth for how a
// route/parameter-mutation attack's observed effects map onto the three-tier
// severity model, and for which browser/network events are expected noise that
// must NOT create findings or trigger recovery.
//
// Consumers:
//   • StabilityMonitor.attachNetworkMonitoring — the finding authority. Uses
//     isExpectedResourceNoise() + classifyHttpStatus() to decide whether a
//     response becomes a finding (MEDIUM+) or informational telemetry only.
//   • RouteTrasher — annotates its immutable scenario window with severity-
//     labelled narration and returns per-run severity counts (no findings; the
//     globally-attached StabilityMonitor owns finding creation to avoid dupes).
//
// The tiers (per product spec):
//   CRITICAL      — unhandled client-side exception, browser crash, white-screen.
//                   Capture recent action history → reproducible finding.
//   MEDIUM        — HTTP 5xx caused by route/parameter mutation, or a soft-fail
//                   body masked behind a 2xx. Backend validation failure finding.
//   INFORMATIONAL — expected defensive response (HTTP 4xx) handled gracefully
//                   without an uncaught frontend error. Telemetry only, no finding.

import type { ApiResponseTrace, ConsoleAnomaly } from '../../../infrastructure/monitoring/anomalyListeners.js';

/** The three-tier severity model for route-trashing effects. */
export type RouteTrashSeverity = 'CRITICAL' | 'MEDIUM' | 'INFORMATIONAL';

/**
 * Canonical "defensive" client-error statuses — a correctly-behaving backend
 * returns these to reject malformed/unauthorized/absent requests. Observing one
 * is EXPECTED behavior under route/parameter mutation, not a defect. Kept as an
 * explicit, documented set even though every 4xx is treated as informational,
 * so the intent (these are the graceful-rejection codes we deliberately provoke)
 * is self-describing.
 */
export const DEFENSIVE_CLIENT_STATUSES: ReadonlySet<number> = new Set([
  400, // Bad Request       — malformed input / invalid route param rejected
  401, // Unauthorized      — auth required
  403, // Forbidden         — authorization boundary enforced
  404, // Not Found         — mutated route/resource does not exist
  405, // Method Not Allowed
  406, // Not Acceptable
  409, // Conflict
  410, // Gone
  415, // Unsupported Media Type
  422, // Unprocessable Entity — validation rejected the payload
  429, // Too Many Requests
]);

/** Non-API resource types whose failed loads are browser noise, never app faults. */
const ASSET_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  'image',
  'font',
  'media',
  'stylesheet',
  'script',
  'manifest',
  'texttrack',
  'other',
]);

/** URL suffixes of static assets — backstops resourceType when it is ambiguous. */
const ASSET_URL_PATTERN =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|css|js|mjs|map|mp4|webm|ogg|mp3|wav|json)(?:[?#].*)?$/i;

/** A caller-supplied render probe used to detect a white-screen failure. */
export interface RenderProbe {
  /** Length of visible, trimmed body text after the mutation. */
  visibleTextLength: number;
  /** Count of rendered element nodes in <body> after the mutation. */
  visibleElementCount: number;
  /** Whether the document body element exists at all. */
  hasBody: boolean;
}

/** Verdict for a single observed HTTP response. */
export interface HttpResponseVerdict {
  severity: RouteTrashSeverity;
  /** True only when this response should become a finding (MEDIUM+). */
  createFinding: boolean;
  /** Human-readable reason, safe to surface in telemetry/narration. */
  reason: string;
}

/**
 * Decide whether a response is expected browser/network noise that must be
 * ignored entirely (no telemetry finding, no failure count, no recovery).
 *
 * Genuine application traffic is xhr/fetch — those are always classified, never
 * noise. Any OTHER resource type (image/font/script/stylesheet/document sub-
 * resource) failing with a client/redirect status is ordinary page chatter
 * (a missing favicon, a lazy-loaded image 404, a cache-miss revalidation) and
 * is filtered so a route-mutation run cannot be polluted by it.
 */
export function isExpectedResourceNoise(url: string, resourceType: string, status: number): boolean {
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    return false; // real API traffic — always worth classifying
  }
  // Non-API subresource: a failed/redirected static asset load is expected noise.
  if (status >= 400 && (ASSET_RESOURCE_TYPES.has(resourceType) || ASSET_URL_PATTERN.test(url))) {
    return true;
  }
  return false;
}

/**
 * Classify a single HTTP response into the three-tier model.
 *
 * @param status        HTTP status code.
 * @param opts.softFailBody  A <400 response whose body flags an error (masked failure).
 */
export function classifyHttpStatus(status: number, opts?: { softFailBody?: boolean }): HttpResponseVerdict {
  if (status >= 500) {
    return {
      severity: 'MEDIUM',
      createFinding: true,
      reason: `HTTP ${status} server error — backend failed to handle the mutated request.`,
    };
  }
  if (opts?.softFailBody) {
    return {
      severity: 'MEDIUM',
      createFinding: true,
      reason: `HTTP ${status} with an error-flagged body — soft failure masked as success.`,
    };
  }
  if (status >= 400) {
    return {
      severity: 'INFORMATIONAL',
      createFinding: false,
      reason: `HTTP ${status} defensive response — request rejected gracefully.`,
    };
  }
  return {
    severity: 'INFORMATIONAL',
    createFinding: false,
    reason: `HTTP ${status} — normal response.`,
  };
}

/**
 * Classify a captured console/page anomaly. An uncaught page error or an
 * error-level console message indicates an unhandled client-side failure
 * (CRITICAL); a warning is informational and never a finding on its own.
 */
export function classifyClientAnomaly(anomaly: ConsoleAnomaly): RouteTrashSeverity {
  if (anomaly.type === 'pageerror' || anomaly.type === 'error') {
    return 'CRITICAL';
  }
  return 'INFORMATIONAL';
}

/**
 * Detect a white-screen / render-failure: the mutated route left the app with no
 * body, or a body that renders effectively nothing (no visible text and at most
 * a single wrapper node). Pure over a caller-captured probe so it is testable and
 * never touches Playwright here.
 */
export function isWhiteScreenFailure(probe: RenderProbe): boolean {
  if (!probe.hasBody) {
    return true;
  }
  return probe.visibleTextLength === 0 && probe.visibleElementCount <= 1;
}

/** Aggregate classification of one navigation step's observed effects. */
export interface NavStepClassification {
  /** Highest severity observed across the step. */
  severity: RouteTrashSeverity;
  /** Count of 5xx / soft-fail backend failures (MEDIUM). */
  serverErrors: number;
  /** Count of 4xx defensive responses (INFORMATIONAL). */
  defensiveResponses: number;
  /** Count of unhandled client-side exceptions/console errors (CRITICAL). */
  clientCrashes: number;
  /** Whether the step warrants a finding (CRITICAL or MEDIUM present). */
  createsFinding: boolean;
}

/** The subset of a nav-step snapshot this classifier reads. */
export interface NavStepEffects {
  readonly apiResponses: ReadonlyArray<ApiResponseTrace>;
  readonly consoleAnomalies: ReadonlyArray<ConsoleAnomaly>;
}

/**
 * Aggregate a navigation step's captured API responses and console/page
 * anomalies into a single severity verdict. Deterministic: identical effects
 * always yield an identical classification.
 */
export function classifyNavStep(effects: NavStepEffects): NavStepClassification {
  let serverErrors = 0;
  let defensiveResponses = 0;
  let clientCrashes = 0;

  for (const response of effects.apiResponses) {
    const verdict = classifyHttpStatus(response.status);
    if (verdict.createFinding) {
      serverErrors += 1;
    } else if (response.status >= 400) {
      defensiveResponses += 1;
    }
  }

  for (const anomaly of effects.consoleAnomalies) {
    if (classifyClientAnomaly(anomaly) === 'CRITICAL') {
      clientCrashes += 1;
    }
  }

  const severity: RouteTrashSeverity =
    clientCrashes > 0 ? 'CRITICAL' : serverErrors > 0 ? 'MEDIUM' : 'INFORMATIONAL';

  return {
    severity,
    serverErrors,
    defensiveResponses,
    clientCrashes,
    createsFinding: severity !== 'INFORMATIONAL',
  };
}

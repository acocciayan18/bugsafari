// ═══════════════════════════════════════════════════════════════
// shared/types/telemetryRouting.ts — NETWORK vs FINDING DECISION TREE
// ═══════════════════════════════════════════════════════════════
// The single place that answers "is this observation raw network telemetry, or an
// actionable defect?". Pure, deterministic, dependency-free so BOTH the engine
// (StabilityMonitor, route/chaos scenarios) and the dashboard (Network tab, Errors
// tab) route identically — live, replayed and saved streams included.
//
// The rule, in order:
//   1. Static-asset chatter                       → Network tab only.
//   2. Chaos-injected failure                     → Finding (the app's handling is under test).
//   3. Failure that broke the UI / threw at runtime → Finding.
//   4. Cancelled/aborted request                  → Network tab only.
//   5. Infrastructure & environment (DNS, offline, TLS/cert, proxy, CORS,
//      driver timeouts, extension noise)          → Network tab only.
//   6. HTTP 5xx, or an error payload masked behind a 2xx → Finding.
//   7. Everything else (4xx, redirects, successes, plain transport failures)
//                                                 → Network tab only.
// Provenance (faultOrigin) answers a DIFFERENT question — whose code is at fault —
// and feeds step 5 here; it never decides the surface on its own.

/** Where an observation belongs. */
export type TelemetrySurface = 'NETWORK_ONLY' | 'FINDING';

/** Severity tier carried on the routed row/finding. */
export type RoutingTier = 'INFORMATIONAL' | 'MEDIUM' | 'CRITICAL';

/** Why the router decided what it decided — stable codes, safe to assert on. */
export type RoutingReasonCode =
  | 'ASSET_NOISE'
  | 'CHAOS_INJECTED'
  | 'CHAOS_ABSORBED'
  | 'BROKE_UI'
  | 'CANCELLED'
  | 'ENVIRONMENT'
  | 'HARNESS_ARTIFACT'
  | 'CORS_BLOCKED'
  | 'SERVER_ERROR'
  | 'SOFT_FAIL_BODY'
  | 'DEFENSIVE_CLIENT_ERROR'
  | 'REDIRECT_ERROR'
  | 'TRANSPORT_FAILURE'
  | 'SUCCESS';

// Reason codes that are never the target app's own behaviour: the engine cancelled
// the request, it's static-asset chatter, or it's a harness/browser artifact. The
// single source both the engine (recordNetworkLog) and the dashboard Network tab use
// to keep a genuine-failures view — so live and saved rows can never diverge.
export const NON_TARGET_NETWORK_REASONS: ReadonlySet<string> = new Set<RoutingReasonCode>([
  'CANCELLED',
  'ASSET_NOISE',
  'HARNESS_ARTIFACT',
]);

/** The reason codes that make an observation a finding rather than a Network row. */
export const PROMOTABLE_REASON_CODES: ReadonlySet<string> = new Set<RoutingReasonCode>([
  'CHAOS_INJECTED',
  'BROKE_UI',
  'SERVER_ERROR',
  'SOFT_FAIL_BODY',
]);

/** True when a recorded routing decision belongs in Findings/Errors. */
export function isPromotableReason(reasonCode: string | undefined): boolean {
  return reasonCode !== undefined && PROMOTABLE_REASON_CODES.has(reasonCode);
}

/** Root-cause origins the router treats as non-application infrastructure. */
export const NON_APPLICATION_ORIGINS: ReadonlySet<string> = new Set([
  'NETWORK_ENV',
  'PLAYWRIGHT',
  'BUGSAFARI',
  'BROWSER_EXTENSION',
  'THIRD_PARTY_SDK',
]);

export interface NetworkRoutingInput {
  /** A settled HTTP response, or a request that never produced one. */
  kind: 'HTTP_RESPONSE' | 'TRANSPORT_FAILURE';
  statusCode?: number;
  url?: string;
  /** Playwright resource type — distinguishes API traffic from asset chatter. */
  resourceType?: string;
  /** Transport error text (`net::ERR_…`) or any failure prose to pattern-match. */
  failureText?: string;
  /** A <400 response whose body flags an error (masked failure). */
  softFailBody?: boolean;
  /** The failure was deliberately injected by a chaos scenario. */
  chaosInjected?: boolean;
  /** A UI/runtime exception was correlated with this failure. */
  causedRuntimeFault?: boolean;
  /** Provenance verdict, when the caller has one (engine only). */
  origin?: string;
}

export interface NetworkRoutingVerdict {
  surface: TelemetrySurface;
  /** Convenience mirror of `surface === 'FINDING'`. */
  promote: boolean;
  tier: RoutingTier;
  reasonCode: RoutingReasonCode;
  /** Operator-readable sentence; safe for the Network row or a suppression note. */
  reason: string;
}

// ── Shared signal vocabulary (also consumed by the provenance classifier) ──

/** BugSafari's own injected scripts/markers — never the app under test. */
export const BUGSAFARI_MARKERS: readonly string[] = ['[bugsafari', 'bugsafari-inject', '__bugsafari'];

/** Playwright / automation-driver artifacts (closed page, waits, driver timeouts). */
export const PLAYWRIGHT_MARKERS: readonly string[] = [
  'target page, context or browser has been closed',
  'target closed',
  'browser has been closed',
  'execution context was destroyed',
  'browsertype.launch',
  'browser.newcontext',
  'browsercontext.newpage',
  'browser.newpage',
  'page.goto',
  'page.evaluate',
  'waiting for selector',
  'waiting for locator',
  'locator.',
  'timeout exceeded',
  'timeout of',
  'navigation timeout',
];

/**
 * Cancellations. Anchored to net-error tokens / explicit request phrasing: a bare
 * "cancelled" also appears in legitimate app errors ("Payment cancelled by gateway").
 */
export const ABORT_PATTERNS: readonly RegExp[] = [
  /net::err_aborted/,
  /\berr_aborted\b/,
  /\brequest (?:was )?(?:cancell?ed|aborted)\b/,
  /\b(?:operation|action|navigation) (?:was )?(?:cancell?ed|aborted)\b/,
];

/** Benign browser/devtools chatter, not app defects. */
export const BROWSER_NOISE_MARKERS: readonly string[] = [
  'resizeobserver loop limit exceeded',
  'resizeobserver loop completed',
  'non-error promise rejection captured',
  'script error.',
];

/**
 * Embedded third-party SDK console noise (social widgets, chat, analytics). A caught-
 * and-logged error from a vendor SDK the page embeds is the vendor's concern, not a
 * defect in the app under test. Markers are unmistakable vendor signatures only —
 * kept narrow so a genuine first-party exception is never suppressed.
 */
export const THIRD_PARTY_SDK_MARKERS: readonly string[] = [
  'fburl.com', // Facebook debug-link suffix appended to its own console errors
  'errorutils caught', // Facebook / React Native global error util
  'startstreamfailure', // Facebook GraphQL streaming subscription failure
  'connect.facebook.net', // Facebook JS SDK host (stack / source URL)
  'graph.facebook.com', // Facebook Graph API host (stack / source URL)
];

export const EXTENSION_URL_PREFIXES: readonly string[] = [
  'chrome-extension://',
  'moz-extension://',
  'safari-extension://',
  'devtools://',
];

/** No network, broken DNS, misconfigured TLS/proxy — environmental whoever the host. */
export const ENVIRONMENT_TRANSPORT_MARKERS: readonly string[] = [
  'err_name_not_resolved',
  'err_name_resolution_failed',
  'err_internet_disconnected',
  'err_network_changed',
  'err_address_unreachable',
  'err_cert_',
  'err_ssl_',
  'err_proxy_connection_failed',
];

/**
 * Transport failures whose ROOT CAUSE depends on which host failed (see faultOrigin).
 * For routing they are still infrastructure: a refused/reset/timed-out request only
 * becomes a finding once it is chaos-injected or observably breaks the UI.
 */
export const HOST_DEPENDENT_TRANSPORT_MARKERS: readonly string[] = [
  'err_connection_refused',
  'err_connection_reset',
  'err_connection_closed',
  'err_connection_aborted',
  'err_connection_failed',
  'err_connection_timed_out',
  'err_timed_out',
  'err_empty_response',
  'err_response_headers_truncated',
  'err_http2_protocol_error',
];

/**
 * Redirect loop — the target bounced a request between locations without resolving.
 * A target-side navigation defect (CWE-835), so its Network row is SHOWN (unlike a
 * cancellation), while the corresponding finding is raised by the navigation subsystem.
 */
export const REDIRECT_ERROR_MARKERS: readonly string[] = [
  'err_too_many_redirects',
  'too many redirects',
  'redirect loop',
];

/** Browser-enforced cross-origin blocks — a deployment/config concern, not a defect. */
export const CORS_MARKERS: readonly string[] = [
  'err_blocked_by_response',
  'err_blocked_by_client',
  'blocked by cors policy',
  'access-control-allow-origin',
  'cross-origin request blocked',
  'preflight',
];

/** Non-API resource types whose failed loads are browser noise, never app faults. */
export const ASSET_RESOURCE_TYPES: ReadonlySet<string> = new Set([
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
export const ASSET_URL_PATTERN =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|css|js|mjs|map|mp4|webm|ogg|mp3|wav|json)(?:[?#].*)?$/i;

/**
 * Canonical "defensive" client-error statuses — a correctly-behaving backend
 * returns these to reject malformed/unauthorized/absent requests. Documented as an
 * explicit set even though every 4xx routes to the Network tab.
 */
export const DEFENSIVE_CLIENT_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 405, 406, 409, 410, 415, 422, 429,
]);

const includesAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

const matchesAny = (haystack: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(haystack));

/** True for a request whose failure is ordinary static-asset chatter. */
export function isStaticAssetRequest(url?: string, resourceType?: string): boolean {
  const type = (resourceType ?? '').toLowerCase();
  if (type === 'xhr' || type === 'fetch' || type === 'document') return false;
  return ASSET_RESOURCE_TYPES.has(type) || ASSET_URL_PATTERN.test(url ?? '');
}

/** True when the text carries a browser cross-origin block. */
export function isCorsBlocked(text: string): boolean {
  return includesAny(text, CORS_MARKERS);
}

/** True when the text is a target-side redirect loop (ERR_TOO_MANY_REDIRECTS). */
export function isRedirectError(text: string): boolean {
  return includesAny(text, REDIRECT_ERROR_MARKERS);
}

/** True when the text is an infrastructure/environment transport failure. */
export function isInfrastructureFailure(text: string): boolean {
  return (
    includesAny(text, ENVIRONMENT_TRANSPORT_MARKERS) || includesAny(text, HOST_DEPENDENT_TRANSPORT_MARKERS)
  );
}

/** True when the text is a harness/driver/browser artifact rather than app behaviour. */
export function isHarnessArtifact(text: string, url = ''): boolean {
  return (
    includesAny(text, BUGSAFARI_MARKERS) ||
    includesAny(url, BUGSAFARI_MARKERS) ||
    includesAny(url, EXTENSION_URL_PREFIXES) ||
    includesAny(text, BROWSER_NOISE_MARKERS) ||
    includesAny(text, PLAYWRIGHT_MARKERS)
  );
}

/** True when the text says the request was cancelled/aborted rather than failed. */
export function isCancelledRequest(text: string): boolean {
  return matchesAny(text, ABORT_PATTERNS);
}

const verdict = (
  surface: TelemetrySurface,
  tier: RoutingTier,
  reasonCode: RoutingReasonCode,
  reason: string,
): NetworkRoutingVerdict => ({ surface, promote: surface === 'FINDING', tier, reasonCode, reason });

/**
 * Route one network observation. See the ordered rule list at the top of this file —
 * the sequence is load-bearing: chaos injection and UI breakage outrank the
 * cancellation/environment filters, because a deliberately-aborted request that the
 * app failed to handle IS the defect under test.
 */
export function routeNetworkEvent(input: NetworkRoutingInput): NetworkRoutingVerdict {
  const text = `${input.failureText ?? ''}`.toLowerCase();
  const url = (input.url ?? '').toLowerCase();
  const status = input.statusCode;

  // Nothing below promotes a healthy exchange: a chaos-injected or UI-breaking
  // observation only escalates when the request itself actually failed.
  const failed =
    input.kind === 'TRANSPORT_FAILURE' || (status !== undefined && status >= 400) || Boolean(input.softFailBody);

  if (isStaticAssetRequest(input.url, input.resourceType) && (status === undefined || status >= 400)) {
    return verdict('NETWORK_ONLY', 'INFORMATIONAL', 'ASSET_NOISE', 'Static asset failed to load. This is normal page activity and not a finding.');
  }

  // A DEFENSIVE 4xx (the backend correctly rejecting the request) is NOT a failure to handle
  // the injected fault: a Delayed sabotage preserves the app's own 401/403/404, and a Mutated
  // body the backend rejects with 400/422 is correct handling. Promoting it manufactured a
  // phantom "failed to handle the simulated failure" from every normal login rejection under an
  // armed saboteur. Genuine mishandling still promotes below — a 5xx, an error payload, a
  // transport failure, or actual UI breakage (BROKE_UI).
  const defensiveClientStatus = status !== undefined && status >= 400 && status < 500;

  // A failed request that broke the UI (unhandled error / stuck view) is the real defect — and it
  // also covers a chaos-injected fault the app FAILED to absorb. Checked before the chaos branch so
  // a genuine break outranks the resilience-pass note.
  if (input.causedRuntimeFault && failed) {
    return verdict(
      'FINDING',
      'CRITICAL',
      'BROKE_UI',
      'The failed request left the interface broken (unhandled error or stuck UI).',
    );
  }

  // An injected TRANSPORT abort the app ABSORBED — no runtime fault, no stuck UI — is a resilience
  // pass, not a defect. Injecting a fault is not itself proof the app mishandled it (the old branch
  // asserted "failed to handle" from injection alone, flagging every resilient app). It stays a
  // Network observation; if the app breaks within the correlation window the arbiter re-promotes it
  // as BROKE_UI above. Scoped to TRANSPORT_FAILURE so a chaos-injected 5xx or error payload still
  // promotes as the genuine SERVER_ERROR / SOFT_FAIL_BODY below.
  if (input.chaosInjected && input.kind === 'TRANSPORT_FAILURE') {
    return verdict(
      'NETWORK_ONLY',
      'INFORMATIONAL',
      'CHAOS_ABSORBED',
      'Injected network fault; the application absorbed it without a visible break (resilience pass).',
    );
  }

  if (isCancelledRequest(text)) {
    return verdict('NETWORK_ONLY', 'INFORMATIONAL', 'CANCELLED', 'Request was cancelled (navigation, stop, or superseded call).');
  }

  if (isCorsBlocked(text)) {
    return verdict('NETWORK_ONLY', 'INFORMATIONAL', 'CORS_BLOCKED', 'Blocked by the browser’s cross-origin policy. This is a configuration issue, not an application defect.');
  }

  if (isHarnessArtifact(text, url) || (input.origin !== undefined && isHarnessOrigin(input.origin))) {
    return verdict('NETWORK_ONLY', 'INFORMATIONAL', 'HARNESS_ARTIFACT', 'Test-harness or browser artifact, not application behaviour.');
  }

  if (isInfrastructureFailure(text) || input.origin === 'NETWORK_ENV') {
    return verdict(
      'NETWORK_ONLY',
      'INFORMATIONAL',
      'ENVIRONMENT',
      'Infrastructure or environment failure (DNS, connectivity, TLS, proxy, or an unreachable host).',
    );
  }

  // A redirect loop resolves to no status — classify it explicitly so the Network row
  // reads "redirect loop" instead of a raw net:: string, consistently on every surface.
  if (isRedirectError(text)) {
    return verdict('NETWORK_ONLY', 'MEDIUM', 'REDIRECT_ERROR', 'Redirect loop. The server repeatedly redirected the request without reaching a final destination.');
  }

  if (status !== undefined && status >= 500) {
    return verdict('FINDING', 'MEDIUM', 'SERVER_ERROR', `HTTP ${status} server error. The backend failed to process the request.`);
  }

  if (input.softFailBody) {
    return verdict(
      'FINDING',
      'MEDIUM',
      'SOFT_FAIL_BODY',
      `HTTP ${status ?? 200} returned an error payload, indicating that the request reported success at the HTTP level but the application response indicates a failure.`,
    );
  }

  if (status !== undefined && status >= 400) {
    return verdict(
      'NETWORK_ONLY',
      'INFORMATIONAL',
      'DEFENSIVE_CLIENT_ERROR',
      `HTTP ${status}. The request was rejected as expected by the application.`,
    );
  }

  if (input.kind === 'TRANSPORT_FAILURE') {
    return verdict(
      'NETWORK_ONLY',
      'INFORMATIONAL',
      'TRANSPORT_FAILURE',
      'Request failed before a response arrived, with no visible effect on the interface.',
    );
  }

  return verdict('NETWORK_ONLY', 'INFORMATIONAL', 'SUCCESS', `HTTP ${status ?? 200}. Normal response.`);
}

/** True for a provenance origin that is a harness/browser artifact. */
export function isHarnessOrigin(origin: string): boolean {
  return origin === 'PLAYWRIGHT' || origin === 'BUGSAFARI' || origin === 'BROWSER_EXTENSION';
}

// ── Site relationship (provenance + Network-tab origin filtering) ──
// Registrable-ish host key (last two labels) so api.example.com === example.com.
// ponytail: two-label heuristic; misgroups multi-part public suffixes (foo.co.uk),
// fine for the single-origin target apps under test — swap for a PSL if that changes.
export function registrableHost(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().split('.').slice(-2).join('.');
  } catch {
    return '';
  }
}

/** Relationship between a URL and the app under test; UNKNOWN when either is unparseable. */
export function siteRelationship(
  url: string | undefined,
  targetOrigin: string | undefined,
): 'FIRST_PARTY' | 'THIRD_PARTY' | 'UNKNOWN' {
  const a = registrableHost(url);
  const b = registrableHost(targetOrigin);
  if (!a || !b) return 'UNKNOWN';
  return a === b ? 'FIRST_PARTY' : 'THIRD_PARTY';
}

/**
 * Dashboard-side guard: decide the surface for a finding payload that already
 * crossed the wire. Runs the same tree over what a stored/streamed finding carries,
 * so a legacy or queued record cannot put infrastructure noise in the Errors tab.
 * Runtime faults (exceptions, races, injections) are never network-routed.
 */
export function routeFindingPayload(payload: {
  type?: string;
  statusCode?: number;
  url?: string;
  message?: string;
  /** Evidence that the app itself misbehaved: a stack trace, or a non-network bug class. */
  hasRuntimeEvidence?: boolean;
}): NetworkRoutingVerdict {
  const type = (payload.type ?? '').toUpperCase();
  const isNetworkFinding = type.includes('NETWORK') || type.includes('API') || type.includes('HTTP');
  if (!isNetworkFinding || payload.hasRuntimeEvidence) {
    return verdict('FINDING', 'MEDIUM', 'BROKE_UI', 'Application-level fault. Always treated as a finding.');
  }
  return routeNetworkEvent({
    kind: payload.statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
    statusCode: payload.statusCode,
    url: payload.url,
    resourceType: 'xhr',
    failureText: payload.message,
  });
}

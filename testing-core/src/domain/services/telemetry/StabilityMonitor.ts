import type { Dialog, Page, Request, Response } from 'playwright';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { decideDialog } from '../exploration/dialogPolicy.js';
import { captureStateFingerprint } from '../../../infrastructure/monitoring/stateFingerprint.js';
import { setupStabilityMonitoring } from '../../../infrastructure/monitoring/stabilityMonitor.js';
import { setupBrowserConsoleListener } from '../../../infrastructure/monitoring/browserConsoleListener.js';
import { NetworkLogStore } from '../../../infrastructure/monitoring/NetworkLogStore.js';
import {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../../infrastructure/database/models/ForensicErrorModel.js';
import {
  classifyFault,
  ensureFindingEvidence,
  isSecurityBugClass,
  matchesCategory,
  FREEZE_SELECTORS,
  INPUT_BLOCK_SELECTORS,
  type FaultType,
} from '../../../bugs/knowledgeBase/index.js';
import { ChaosInjectionRegistry } from '../../../infrastructure/monitoring/chaosInjectionRegistry.js';
import { scrubCredentials } from './credentialScrub.js';
import { ContractResponseCorrelator, looksNonJsonBody } from './contractCorrelation.js';
import { resolveRuntimeCulprit } from './runtimeCulprit.js';
import { resolveControlName, isDescriptiveControlName } from '../../../../../shared/reproduction.js';
import { RuntimeStabilityFinder, isMediaPlaybackError, type RuntimeObservation, type RuntimeSubtype } from '../../heuristics/RuntimeStabilityFinder.js';
import { DuplicateActionFinder, buildDuplicateReplaySteps, type DuplicateActionDefect } from '../../heuristics/DuplicateActionFinder.js';
import { ApiHangFinder, isBackgroundTelemetryUrl, isLongLivedRequestUrl, type LoadingProbe, type HangDiagnostic, type HangTrigger } from '../../heuristics/ApiHangFinder.js';
import { initialSweepState, isSweepDue, advanceSweep, type SweepPolicy } from '../../heuristics/hangSweep.js';
import { resolveScenarioAttribution } from '../../../bugs/knowledgeBase/scenarioCatalog.js';
import type {
  ActionBreadcrumb,
  FaultConfidence,
  FaultSeverity,
  FindingAttribution,
  NetworkRoutingVerdict,
  ReproductionSnapshot,
  StateFingerprint,
} from '../../../../../shared/types.js';
import { isActionableNetworkStatus, routeNetworkEvent, NON_TARGET_NETWORK_REASONS, siteRelationship, PLAYWRIGHT_MARKERS, resolveSeverity, NETWORK_ACTION } from '../../../../../shared/types.js';
import { NetworkQuarantine } from '../../../infrastructure/monitoring/NetworkQuarantine.js';
import { initialDegradeState, onTargetFailure, onTargetSuccess, type DegradeState } from './networkDegradeDecision.js';
import type { StabilityMonitorDeps } from '../exploration/types.js';
import {
  NetworkFaultArbiter,
  VerificationPipeline,
  isBodyReadableResourceType,
  isProxyGatewayArtifact,
  resolveMaskedFailure,
  statusForScore,
  type VerificationCandidate,
} from '../verification/index.js';
import { MAX_SOFT_FAIL_BODY_BYTES } from '../verification/softFailBody.js';
import { SourceMapResolver } from '../../../infrastructure/monitoring/sourceMapResolver.js';
import { sampleMemoryPressure, sampleAdaptiveMemory, type AdaptiveMemory } from '../../../infrastructure/monitoring/resourceProbe.js';

// ACTION marker for a harness-side (BugSafari OOM) abort — the dashboard shows it as a system alert, not a bug.
const HARNESS_RESOURCE_ABORT = 'harness-resource-abort';
// Proactive memory watchdog cadence: poll live cgroup usage during a run so it can stop
// gracefully BEFORE the container OOM-kills the renderer (which only surfaces post-mortem).
const MEMORY_WATCHDOG_TICK_MS = 2000;
// ACTION marker for a demoted browser/GPU/driver crash — an environment fault, never a target finding.
const HARNESS_CRASH_DEMOTED = 'harness-crash-demoted';

// Hang-diagnostic watchdog tunables. A fetch/XHR still pending past HANG_THRESHOLD_MS is a
// hang candidate; CONFIRM_MS is the persistence gap between the two DOM probes; the rest bound cost.
const MAX_PENDING = 300;
const WATCHDOG_TICK_MS = 1000;
const HANG_THRESHOLD_MS = 8000;
const CONFIRM_MS = 2500;
// A client JSON.parse contract fault is correlated back to the most recent non-JSON API
// response that settled inside this window before it — that response is the likely body
// the app tried to parse. Kept tight so an unrelated earlier fetch is never mis-blamed.
// Re-probe policy for a still-pending request — see hangSweep for the rationale.
const SWEEP_POLICY: SweepPolicy = { thresholdMs: HANG_THRESHOLD_MS, reSweepBaseMs: 10000, maxSweeps: 3 };

// Only meaningful traffic (API + navigation) is logged/emitted — static asset
// noise (images/fonts/stylesheets) is excluded from both the live tab and store.
const LOGGED_RESOURCE_TYPES = new Set(['xhr', 'fetch', 'document']);

// Consecutive target-origin transport failures (no success between) that flip the
// run into the degraded window — where findings are quarantined as network noise.
const TARGET_DEGRADE_STREAK = (() => {
  const n = Number(process.env.BUGSAFARI_TARGET_DEGRADE_STREAK);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
})();

/** Maps the knowledge-base severity scale to the persisted forensic-error scale. */
const SEVERITY_TO_FORENSIC: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', ForensicErrorSeverity> = {
  LOW: ForensicErrorSeverity.LOW,
  MEDIUM: ForensicErrorSeverity.MEDIUM,
  HIGH: ForensicErrorSeverity.HIGH,
  CRITICAL: ForensicErrorSeverity.CRITICAL,
};

// Evidence-strength ordering — lets a caller raise (never lower) the confidence used
// for scoring. An uncaught page exception is first-party proof the app threw, so its
// floor is CONFIRMED regardless of how the message-text classifier ranked it.
const CONFIDENCE_RANK: Record<FaultConfidence, number> = { INFERRED: 0, SIGNAL: 1, CONFIRMED: 2 };

// Runtime subtypes that make the tab unusable outright — escalated to CRITICAL over the
// RUNTIME_STABILITY_EXCEPTION MEDIUM default.
const CRITICAL_RUNTIME_SUBTYPES: ReadonlySet<RuntimeSubtype> = new Set<RuntimeSubtype>(['RENDERER_CRASH', 'STACK_OVERFLOW']);

/** Maps the resolved 5-tier FaultSeverity to the persisted forensic-error scale. */
const FAULT_TO_FORENSIC: Record<FaultSeverity, ForensicErrorSeverity> = {
  CRITICAL: ForensicErrorSeverity.CRITICAL,
  HIGH: ForensicErrorSeverity.HIGH,
  MEDIUM: ForensicErrorSeverity.MEDIUM,
  LOW: ForensicErrorSeverity.LOW,
  INFO: ForensicErrorSeverity.INFO,
};

// ─────────────────────────────────────────────────────────────
// Error classification & sanitization helpers (pure)
// ─────────────────────────────────────────────────────────────

/**
 * Sanitizes exception stack traces to prevent information disclosure.
 * Strips internal file paths, Node.js internals, and environment-specific variables
 * before broadcasting EXCEPTION telemetry to the frontend.
 * Task 1: Remediate Information Disclosure
 */
export function sanitizeException(error: Error | string): { message: string; stackTrace: string } {
  const message = typeof error === 'string' ? error : error.message;
  let stackTrace = typeof error === 'string' ? error : (error.stack ?? message);

  // Normalize line separators
  stackTrace = stackTrace.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove file paths that expose server internals
  // Windows paths
  stackTrace = stackTrace.replace(/C:\\Users\\[^\\]+\\/g, '[REDACTED_PATH]/');
  stackTrace = stackTrace.replace(/C:\/[^\/]+\//g, '[REDACTED_PATH]/');
  // Unix/Linux paths
  stackTrace = stackTrace.replace(/\/home\/[^\/]+\//g, '[REDACTED_PATH]/');
  stackTrace = stackTrace.replace(/\/Users\/[^\/]+\//g, '[REDACTED_PATH]/');

  // Remove Node.js internal paths
  stackTrace = stackTrace.replace(/node:[/\\][^\n]*/g, '[NODE_INTERNAL]');
  stackTrace = stackTrace.replace(/\/node_modules\/[^\n]*/g, '[NODE_MODULE]');

  // Remove environment variables references
  stackTrace = stackTrace.replace(/process\.env\.[A-Za-z_0-9]+/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/NODE_ENV=[^\s\n]*/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/DATABASE_URL=[^\s\n]*/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/API_KEY=[^\s\n]*/g, '[ENV_VAR]');
  stackTrace = stackTrace.replace(/SECRET_[A-Za-z_0-9]*/g, '[SECRET]');

  // Remove anonymous function details (anonymous at position ...)
  stackTrace = stackTrace.replace(/anonymous at .+/g, '[anonymous function]');

  // Line/column numbers are kept: these frames are the TARGET app's own browser
  // stack (pageerror runs in the page), so :line:col points a developer straight at
  // the failing source. Only server-internal paths/env are redacted (above).

  // Extract just the error type name if present (e.g., "TypeError:", "ReferenceError:")
  const errorTypeMatch = stackTrace.match(/^([A-Za-z]+Error):/);
  const errorType = errorTypeMatch ? errorTypeMatch[1] : 'Error';

  // Last transform: strip any target-app credential the page echoed back into the
  // error before this reaches telemetry or storage.
  return {
    message: scrubCredentials(`${errorType}: ${message}`),
    stackTrace: scrubCredentials(stackTrace),
  };
}

// A stack frame line: V8 ("    at fn (file:line:col)") or SpiderMonkey ("fn@url:line:col").
const STACK_FRAME_RE = /^\s*(?:at\s|[^\s@]*@[^\s]*:\d+)/;

// Browser-emitted resource-load console errors ("Failed to load resource: the server
// responded with a status of 401") are already captured with full status + class by the
// response/requestfailed handlers; re-catching the console line double-reports them and
// (matching /failed to load/) misclassifies a bare 4xx as a navigation loop (CWE-835).
const RESOURCE_LOAD_CONSOLE_RE = /^Failed to load resource:/i;

// React DEVELOPMENT-only warnings routed to console.error. They never appear in a
// production build and here only fire because the fuzzer typed out-of-range values into
// number inputs — not app defects. Matched on React's DISTINCTIVE full phrasings (not a
// bare "should not be null", which a real app error could carry) so nothing genuine is
// swallowed.
const REACT_DEV_WARNING_RE = /received nan for the \S+ attribute|prop on \S+ should not be null\. consider using an empty string|should not be null\. consider using an empty string to clear the component|each child in a (?:list|array) should have a unique ["']?key/i;

// Browser CSP-violation reports ("… violates the following Content Security Policy directive …";
// "Refused to apply inline style/execute inline script because it violates …"). These are the
// browser's own security-policy blocks, not app JS exceptions — often the CSP correctly blocking
// inline execution — so they must never become a RUNTIME_STABILITY_EXCEPTION (CWE-248) with
// inapplicable "wrap in try/catch" advice. The full phrase is unique to these reports.
const CSP_VIOLATION_RE = /content security policy/i;

// Error-level console lines that must NOT become findings: network-stack errors (already
// covered by response/requestfailed monitoring), browser resource-load errors (ditto, and
// their "failed to load" text otherwise misclassifies a bare 4xx as a navigation loop),
// React development-only warnings (absent in production; here only provoked by fuzzed input),
// and browser CSP-violation reports (a security-policy block, not an app JS exception).
export function isIgnorableConsoleError(text: string): boolean {
  if (!text) return false;
  if (text.includes('net::ERR') || text.includes('ERR_')) return true;
  if (RESOURCE_LOAD_CONSOLE_RE.test(text)) return true;
  if (REACT_DEV_WARNING_RE.test(text)) return true;
  if (CSP_VIOLATION_RE.test(text)) return true;
  // Media-playback errors ("no supported sources") are an environment artifact: Playwright's
  // codec-less bundled Chromium rejects H.264/AAC that real Chrome decodes. Suppress as noise.
  if (isMediaPlaybackError(text)) return true;
  return false;
}

/**
 * Split a raw runtime fault into its human diagnostic message and its stack trace so
 * the two never share one field. A pageerror already separates them (message + stack),
 * but a console error usually arrives as one blob ("Error: x\n    at f (a.js:1:1)…").
 * The leading non-frame lines are the message; the "at …" frames are the stack. An
 * explicit stack always wins; a plain message with no frames yields an empty stack.
 */
export function separateMessageAndStack(rawMessage: string, stack?: string): { message: string; stackTrace: string } {
  const normalized = (rawMessage ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const firstFrame = lines.findIndex((line) => STACK_FRAME_RE.test(line));
  const messageLines = firstFrame >= 0 ? lines.slice(0, firstFrame) : lines;
  const message = messageLines.join('\n').trim() || normalized.trim() || 'Unknown runtime error';
  const explicitStack = (stack ?? '').trim();
  if (explicitStack) return { message, stackTrace: explicitStack };
  const embeddedStack = firstFrame >= 0 ? lines.slice(firstFrame).join('\n').trim() : '';
  return { message, stackTrace: embeddedStack };
}

// Remediation is now sourced from the knowledge-base bug catalog via the
// classifier (see classifyAndAttribute); the former buildRemediation() helper was
// removed to keep remediation single-sourced.

/**
 * Checks if the error is a browser/context closed error that occurs when operator
 * manually stops the test. These should be treated as graceful shutdown, not fatal errors.
 * Playwright throws "Target page, context or browser has been closed" when browser closes
 * during a pending action like page.goto().
 */
export function isBrowserClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('closed') ||
         message.includes('Target page, context or browser has been closed');
}

/**
 * Broader than isBrowserClosedError: the full family of Playwright lifecycle
 * exceptions thrown when the engine is intentionally torn down (operator stop,
 * cancel, timebox, crash termination) — closed page/context/browser AND
 * "Execution context was destroyed", "Target closed", in-flight goto/evaluate
 * against a dying page. Reuses the shared driver-marker vocabulary so this
 * stop-guard and the provenance classifier can never disagree about what a
 * teardown artifact looks like. Root cause is the harness, never the target app.
 */
export function isEngineLifecycleError(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return text.includes('closed') || PLAYWRIGHT_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Checks if the network failure is a user-initiated cancellation (ERR_ABORTED).
 * When users cancel a Safari session right after hitting start, unresolved HTTP requests
 * are forcefully cancelled by the browser, throwing net::ERR_ABORTED errors.
 * These false-positive errors should be demoted to informational ACTION instead of EXCEPTION.
 */
export function isNetworkAbortedError(errorText: string | undefined | null): boolean {
  if (!errorText) return false;
  const lower = errorText.toLowerCase();
  return lower.includes('net::err_aborted') ||
         lower.includes('err_aborted') ||
         lower.includes('aborted') ||
         lower.includes('request cancelled') ||
         lower.includes('canceled');
}

/**
 * Checks if a stress scenario is currently executing. Stress scenarios
 * (RouteTrasher, CoordinateBombing, etc.) naturally cause many network aborts
 * as part of their rapid-fire testing, so we suppress spam telemetry during runs.
 */
export function isStressScenarioActive(): boolean {
  const scenario = ActiveScenarioTracker.getActiveScenarioName();
  if (!scenario) return false;
  const stressScenarios = ['RouteTrasher', 'CoordinateBombing', 'ButtonSpammer', 'AsyncStateRacer'];
  return stressScenarios.some((s) => scenario.includes(s));
}

/**
 * Checks if a concurrency / rapid-click scenario is executing, used to corroborate a
 * duplicate-action finding: a duplicate observed while one of these probes provokes
 * double-submits is far more likely a genuine missing-guard defect than coincidence.
 */
export function isRaceScenarioActive(): boolean {
  const scenario = ActiveScenarioTracker.getActiveScenarioName();
  if (!scenario) return false;
  const raceScenarios = ['AsyncStateRacer', 'ButtonSpammer'];
  return raceScenarios.some((s) => scenario.includes(s));
}

/**
 * Everything needed to report ONE network fault, frozen at the instant it failed.
 * A failure that routes to the Network tab is parked with this payload: if the app
 * then throws because the call died, the arbiter hands it back and it is promoted
 * with the evidence from failure time, not from 2s later.
 */
interface NetworkFaultEvidence {
  page: Page;
  request: Request;
  timestamp: string;
  faultAtMs: number;
  url: string;
  method: string;
  reason: string;
  detail: string;
  statusCode?: number;
  bodyContent?: string;
  durationMs?: number;
  triggeringAction?: string;
  culpritSelector?: string;
  breadcrumbs: ActionBreadcrumb[];
  reproduction: ReproductionSnapshot;
  stateFingerprint?: StateFingerprint;
  /** Sabotage mode when this failure was chaos-injected. */
  chaosMode?: string;
}

// ─────────────────────────────────────────────────────────────
// Raw-network row enrichment (pure) — headers + trace id extraction
// ─────────────────────────────────────────────────────────────

// Correlation/trace headers, checked in order. First present wins.
const TRACE_HEADER_KEYS = [
  'x-request-id', 'request-id', 'x-correlation-id', 'x-trace-id', 'trace-id',
  'x-amzn-trace-id', 'x-b3-traceid', 'traceparent', 'x-cloud-trace-context',
];

// Headers worth surfacing on a Network row. Deliberately EXCLUDES authorization,
// cookie, and set-cookie (least privilege — never echo credentials to the UI) and
// server-fingerprint/size noise (content-length, server, x-powered-by).
const KEEP_HEADER_KEYS: ReadonlySet<string> = new Set<string>([
  'content-type', 'cache-control', 'retry-after',
  'location', 'x-ratelimit-remaining', 'x-ratelimit-limit', 'accept',
  ...TRACE_HEADER_KEYS,
]);

// Curated, size-bounded header subset — never the full header bag (payload + secrets).
function pickHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (!KEEP_HEADER_KEYS.has(key)) continue;
    out[key] = String(value).slice(0, 256);
    if (++n >= 12) break;
  }
  return Object.keys(out).length ? out : undefined;
}

// Clean endpoint path for display: strips the ephemeral tunnel origin + query so a
// finding reads "GET /api/soft-fail", not a random trycloudflare host. Falls back to
// the query-stripped raw value if the URL is relative/unparseable.
function endpointPath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname || rawUrl;
  } catch {
    return rawUrl.split('?')[0] ?? rawUrl;
  }
}

// First present trace/correlation id across the curated header keys.
function extractTraceId(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined;
  for (const key of TRACE_HEADER_KEYS) {
    if (headers[key]) return String(headers[key]).slice(0, 128);
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// StabilityMonitor — attaches fault-catching page listeners
// ─────────────────────────────────────────────────────────────

/**
 * Collects exceptions, trace catches, and unhandled browser hangs by attaching
 * the full battery of Playwright fault listeners (page errors, console errors,
 * failing/4xx-5xx responses, dialogs) plus the background heartbeat/console
 * monitors. All faults are routed through telemetry, the forensic DB, and the
 * confirmed-bug ledger via the injected dependencies.
 */
export class StabilityMonitor {
  // One verification pipeline per run: gates every caught fault on provenance +
  // evidence before it can become a reported finding, and tracks recurrence /
  // cross-channel correlation for the consistency check.
  private readonly verifier = new VerificationPipeline();

  // Fine-grained runtime-error classifier + collapse-count dedup (one per run).
  private readonly runtimeFinder = new RuntimeStabilityFinder();

  // Parks network failures that routed to the Network tab; a runtime fault landing
  // inside the correlation window claims them back as genuine findings.
  private readonly networkArbiter = new NetworkFaultArbiter<NetworkFaultEvidence>();

  // Collapse repeats of the same network-fault signature (method+endpoint+status) into
  // one finding with an occurrence count — mirrors the runtime/duplicate/hang finders.
  // Maps bugId → times seen this run; every raw instance still lives on the Network tab.
  private readonly reportedNetworkFaults = new Map<string, number>();

  // Two-phase double-submit detector: opens candidates on overlapping identical requests,
  // judges them once the responses settle (one per run).
  private readonly duplicateFinder = new DuplicateActionFinder();
  // Stable id per Playwright Request so the finder can pair a request with its settlement.
  private readonly requestIds = new WeakMap<Request, string>();
  private requestIdSeq = 0;

  // Infinite-loading detector + the impure edges that feed it: an in-flight fetch/XHR registry,
  // the watchdog interval sweeping it, and a per-endpoint guard against concurrent confirmations.
  private readonly apiHangFinder = new ApiHangFinder();
  private readonly pending = new Map<Request, { url: string; method: string; startMs: number; pageUrl: string; sweeps: number; nextSweepAtMs: number }>();
  private readonly confirming = new Set<string>();
  private watchdogTimer?: ReturnType<typeof setInterval>;
  // Proactive memory watchdog: polls live container memory; latch-fires one harness abort.
  private memoryWatchdogTimer?: ReturnType<typeof setInterval>;
  private memoryAbortFired = false;
  // Independent latch for the lower degrade tier — sheds reclaimable load once before
  // any abort; a run may degrade, recover to 'ok', and still finish.
  private memoryDegradeFired = false;
  // Wall-clock start per request, for duration when Playwright timing is unavailable.
  private readonly requestStartTimes = new WeakMap<Request, number>();
  // One source-map resolver per page so its decoded-map cache survives across faults.
  private readonly resolvers = new WeakMap<Page, SourceMapResolver>();
  // Correlates a client JSON.parse contract fault back to the non-JSON API response that
  // caused it, so the finding's route names the offending endpoint, not the page it threw on.
  private readonly contractCorrelator = new ContractResponseCorrelator();

  // Browser-view target-degradation streak: a run of consecutive target-origin
  // transport failures (cleared by any target-origin success) flips NetworkQuarantine
  // so findings caught while the target is unreachable aren't blamed on the app.
  private degradeState: DegradeState = initialDegradeState();

  constructor(private readonly deps: StabilityMonitorDeps) {}

  // True when a URL belongs to the app under test — third-party failures never count
  // toward the target-degradation streak (a dead ad/analytics host isn't our outage).
  private isTargetOriginUrl(url: string): boolean {
    const origin = this.safeTargetOrigin();
    if (!origin) return false;
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  }

  // A target-origin transport failure: bump the streak; on crossing the threshold,
  // enter the degraded window and tell the operator findings are being suppressed.
  private noteTargetTransportFailure(): void {
    const { state, enterDegraded } = onTargetFailure(this.degradeState, TARGET_DEGRADE_STREAK);
    this.degradeState = state;
    if (enterDegraded && NetworkQuarantine.beginDegraded('target transport failures')) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: NETWORK_ACTION.DEGRADED,
        message: 'Target connection unstable — suppressing findings until it recovers to avoid false reports.',
      });
    }
  }

  // A target-origin response arrived: the target is reachable, so clear the streak
  // and lift the browser-view quarantine (the health monitor owns the paused path).
  private noteTargetReachable(): void {
    const { state, exitDegraded } = onTargetSuccess(this.degradeState);
    this.degradeState = state;
    if (exitDegraded && NetworkQuarantine.endDegraded()) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: NETWORK_ACTION.RECOVERED,
        message: 'Target connection restored — resuming normal finding reporting.',
      });
    }
  }

  // Origin of the app under test; never throws, an unavailable origin degrades provenance
  // to UNKNOWN (host-dependent transport failures then stay environment-attributed).
  private safeTargetOrigin(): string | undefined {
    try {
      return this.deps.getTargetOrigin() || undefined;
    } catch {
      return undefined;
    }
  }

  // One-line description of the interaction that triggered a request, for forensic evidence.
  private triggeringActionFor(atMs: number): string | undefined {
    try {
      const ctx = this.deps.getInteractionContext(atMs);
      return ctx ? resolveControlName({ label: ctx.label, selector: ctx.selector }) : undefined;
    } catch {
      return undefined;
    }
  }

  // The control that actually caused a fault: the interaction active at fault time.
  // Authoritative over the last timeline step, which lags an async fault.
  private culpritSelectorAt(atMs: number): string | undefined {
    try {
      return this.deps.getInteractionContext(atMs)?.selector || undefined;
    } catch {
      return undefined;
    }
  }

  // Human name of the control active at fault time — the accessible label/text when the
  // interaction context knows it, else a semantic descriptor distilled from the selector.
  // Never a raw CSS path (resolveControlName guarantees it). Absent when no control was
  // active, so the UI shows a specific label instead of a generic tag or a selector.
  private culpritLabelAt(atMs: number): string | undefined {
    try {
      const ctx = this.deps.getInteractionContext(atMs);
      if (!ctx?.label && !ctx?.selector) return undefined;
      return resolveControlName({ label: ctx.label, selector: ctx.selector });
    } catch {
      return undefined;
    }
  }

  // Culprit for a network fault, resolved at the request's START — when the control
  // that fired it was active — not its settle time (which may land on a later action).
  // Declines when the request fired during a concurrent burst (two-or-more distinct controls
  // acted at once): the issuing control can't be identified, so naming one sibling is a guess —
  // the finding falls back to the endpoint instead.
  private culpritForRequest(request: Request): string | undefined {
    if (!this.isOwnControlRequest(request)) return undefined;
    const start = this.requestStartTimes.get(request) ?? this.requestSettledAtMs(request);
    if (this.deps.isConcurrentBurstAt?.(start)) return undefined;
    return this.culpritSelectorAt(start);
  }

  // A request that a first-party, main-frame control could actually have issued. A third-party
  // or sub-frame (iframe) request has no app control behind it, so the time-window culprit
  // lookup would blindly stamp the last unrelated click — the phantom-element leak. Decline it.
  private isOwnControlRequest(request: Request): boolean {
    try {
      if (request.frame() !== request.frame().page()?.mainFrame()) return false;
    } catch {
      return false;
    }
    return siteRelationship(request.url(), this.safeTargetOrigin()) !== 'THIRD_PARTY';
  }

  // Chaos mode for a request, but only when it is genuinely the app's own (first-party, main-frame)
  // traffic. A third-party/iframe request cannot "fail to handle" an injected fault it never owned,
  // so it must never promote a CHAOS_INJECTED finding even if a stale registry mark lingers.
  private chaosModeForRequest(request: Request, url: string, atMs: number): string | undefined {
    const mode = ChaosInjectionRegistry.modeFor(url, atMs);
    if (mode === undefined) return undefined;
    return this.isOwnControlRequest(request) ? mode : undefined;
  }

  // Human label of the control that FIRED a network request, resolved at the request's
  // START — same instant as culpritForRequest. Under a rapid stress scenario the settle
  // time lands on a LATER, unrelated click; resolving at start keeps the finding focused
  // on the element that actually triggered the failure, not a combined/adjacent action.
  private triggeringActionForRequest(request: Request): string | undefined {
    if (!this.isOwnControlRequest(request)) return undefined;
    const start = this.requestStartTimes.get(request) ?? this.requestSettledAtMs(request);
    if (this.deps.isConcurrentBurstAt?.(start)) return undefined;
    return this.triggeringActionFor(start);
  }

  // Wall-clock duration of a settled request; prefers Playwright's precise timing.
  private computeRequestDuration(request: Request): number | undefined {
    try {
      const responseEnd = request.timing()?.responseEnd;
      if (typeof responseEnd === 'number' && responseEnd > 0) return Math.round(responseEnd);
    } catch {
      // timing unavailable (e.g. failed request) — fall back to tracked start
    }
    const start = this.requestStartTimes.get(request);
    return start ? Date.now() - start : undefined;
  }

  // Wall-clock instant a request settled — the true fault time for a failed response,
  // earlier than Date.now() once an async body read has run. Falls back to now.
  private requestSettledAtMs(request: Request): number {
    const start = this.requestStartTimes.get(request);
    const duration = this.computeRequestDuration(request);
    return start !== undefined && duration !== undefined ? start + duration : Date.now();
  }

  // Record one settled request into the per-run network log AND stream it live to the
  // Network tab as a marked raw-network row. Only actionable rows persist/stream
  // (transport failures + HTTP >=400); 2xx/3xx successes are dropped. Skips static-asset
  // noise; never throws inside a page listener. This is the SINGLE source of genuine
  // target-app network activity — BugSafari findings/diagnostics never reach this tab.
  private recordNetworkLog(
    request: Request,
    statusCode: number | undefined,
    ok: boolean,
    opts?: { response?: Response; errorText?: string },
  ): void {
    try {
      if (!LOGGED_RESOURCE_TYPES.has(request.resourceType())) return;
      if (!isActionableNetworkStatus(statusCode)) return;

      const url = request.url();
      // Third-party hosts (CDNs, analytics, external APIs) are never the target app's
      // bug — drop them so the Network tab is a view of the application under test.
      // UNKNOWN (origin unresolved) is kept rather than over-dropping a genuine row.
      if (siteRelationship(url, this.safeTargetOrigin()) === 'THIRD_PARTY') return;

      // Route once, at capture, with the SAME tree the live tab and saved report use.
      // Dropping engine/browser noise here (cancelled/asset/harness) keeps NetworkLogStore,
      // the streamed row, and the persisted log a single consistent set — no per-surface drift.
      const routed = routeNetworkEvent({
        kind: statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
        statusCode,
        url,
        resourceType: request.resourceType(),
        failureText: opts?.errorText,
      });
      if (NON_TARGET_NETWORK_REASONS.has(routed.reasonCode)) return;

      const requestHeaders = pickHeaders(this.safeHeaders(request));
      const responseHeaders = pickHeaders(this.safeResponseHeaders(opts?.response));
      const traceId = extractTraceId(responseHeaders) ?? extractTraceId(requestHeaders);
      const errorText = opts?.errorText ? scrubCredentials(opts.errorText) : undefined;
      const durationMs = this.computeRequestDuration(request);
      const method = request.method();

      NetworkLogStore.push({
        timestamp: new Date().toISOString(),
        method,
        url,
        statusCode,
        durationMs,
        resourceType: request.resourceType(),
        ok,
        errorText,
        traceId,
        requestHeaders,
        responseHeaders,
      });

      // Live Network tab: a clean, real request row. rawNetwork marks it so the tab
      // renders ONLY genuine requests, never a NETWORK-channel finding/diagnostic.
      this.deps.telemetry.emit('NETWORK', {
        rawNetwork: true,
        method,
        url,
        statusCode,
        ok,
        errorText,
        traceId,
        requestHeaders,
        responseHeaders,
        durationMs,
      });
    } catch {
      // never let logging throw inside a page listener
    }
  }

  // Response headers, defensively — Playwright can throw once a response is detached.
  private safeResponseHeaders(response?: Response): Record<string, string> | undefined {
    if (!response) return undefined;
    try {
      return response.headers();
    } catch {
      return undefined;
    }
  }

  /**
   * Verify a caught fault before it is reported. Classifies it against the
   * knowledge base, then runs it through the verification pipeline (provenance →
   * correlation → evidence scoring). Returns `report: false` for faults whose root
   * cause is NOT the target application (BugSafari, Playwright, the browser,
   * network/environment) — those are surfaced as informational telemetry only.
   * When reportable, the returned attribution carries the full verification verdict
   * (origin, confidence, verificationStatus, confidenceScore, corroborated) bound
   * identically to the live reports and the saved confirmed bug.
   */
  private verifyFault(
    faultType: FaultType,
    message: string,
    opts?: {
      statusCode?: number;
      url?: string;
      content?: string;
      evidence?: VerificationCandidate['evidence'];
      // Raises (never lowers) the confidence used for scoring. Provenance still gates
      // first — a harness/driver/SDK fault is rejected before the floor can matter.
      confidenceFloor?: FaultConfidence;
      // A 2xx whose body declared a failure — classify as an API contract violation.
      softFail?: boolean;
      // A captured non-JSON response was correlated to this client parse fault — the only
      // evidence that turns a "not valid JSON" EXCEPTION into a real API-contract break.
      contractCorrelated?: boolean;
    },
  ): { report: boolean; advice: string; severity: ForensicErrorSeverity; attribution: FindingAttribution; reason: string } {
    const classification = classifyFault({
      faultType,
      message,
      statusCode: opts?.statusCode,
      url: opts?.url,
      content: opts?.content,
      softFail: opts?.softFail,
      contractCorrelated: opts?.contractCorrelated,
      scenario: ActiveScenarioTracker.getActiveScenarioName(),
      stepIndex: ActiveScenarioTracker.getCurrentStepIndex(),
    });

    const confidence =
      opts?.confidenceFloor && CONFIDENCE_RANK[opts.confidenceFloor] > CONFIDENCE_RANK[classification.confidence]
        ? opts.confidenceFloor
        : classification.confidence;

    const outcome = this.verifier.evaluate({
      faultType,
      message,
      confidence,
      statusCode: opts?.statusCode,
      url: opts?.url,
      content: opts?.content,
      evidence: opts?.evidence,
      targetOrigin: this.safeTargetOrigin(),
    });

    // Network-degraded quarantine: while the target is unreachable, a caught fault is
    // almost certainly the dead network, not an app bug. Demote it to a NETWORK_ENV
    // non-report so a connectivity blip can't manufacture a false finding.
    const quarantined = NetworkQuarantine.isDegraded();

    const attribution: FindingAttribution = {
      bugClass: classification.bugClass,
      cwe: classification.cwe,
      scenario: classification.scenario,
      testingType: classification.testingType,
      stepIndex: classification.stepIndex,
      origin: quarantined ? 'NETWORK_ENV' : outcome.origin,
      confidence: outcome.confidence,
      verificationStatus: outcome.status,
      confidenceScore: outcome.score,
      corroborated: outcome.corroborated,
    };
    // Drop under-evidenced findings (score < 0.5 ⇒ INCONCLUSIVE): they add noise at the
    // same weight as proven bugs. The caller still emits them as informational telemetry.
    const inconclusive = outcome.status === 'INCONCLUSIVE';
    return {
      report: quarantined || inconclusive ? false : outcome.report,
      advice: classification.advice,
      severity: SEVERITY_TO_FORENSIC[classification.severity],
      attribution,
      reason: quarantined
        ? 'Network degraded — target unreachable; fault suppressed to avoid a false report.'
        : inconclusive
          ? 'Inconclusive evidence (confidence below reporting threshold); surfaced as telemetry only, not a finding.'
          : outcome.reason,
    };
  }

  // Lazily create + reuse the per-page source-map resolver (cache persists per page).
  private getResolver(page: Page): SourceMapResolver {
    let resolver = this.resolvers.get(page);
    if (!resolver) {
      resolver = new SourceMapResolver(page);
      this.resolvers.set(page, resolver);
    }
    return resolver;
  }

  /**
   * Answer native dialogs so they never block exploration. The DECISION is a
   * policy of the exploration layer (see dialogPolicy): confirm/alert are accepted
   * so the branch behind them actually runs, prompt is answered with a payload
   * from the fuzz pipeline, and beforeunload is still dismissed so the run is not
   * navigated away from its own state. The branch taken is recorded so a finding's
   * reproduction is unambiguous.
   */
  public attachDialogHandler(page: Page): void {
    const t = this.deps.telemetry;
    page.on('dialog', async (dialog: Dialog) => {
      const type = dialog.type();
      const message = dialog.message();
      const verdict = decideDialog(type, message, this.deps.dialogReadOnly());

      if (verdict.decision === 'accept') {
        await dialog.accept(verdict.promptText || undefined).catch(() => undefined);
      } else {
        await dialog.dismiss().catch(() => undefined);
      }

      const narrative = `Dialog (${type}): "${message}" — ${verdict.reason}`;
      ActiveScenarioTracker.record(narrative);
      t.emit('ACTION', {
        actionExecuted: verdict.decision === 'accept' ? 'dialog-accepted' : 'dialog-dismissed',
        message: narrative,
      });
    });
  }

  // Report one JavaScript runtime fault through the full pipeline: verify (classify +
  // provenance-gate + score), then classify into a fine-grained subtype and collapse
  // same-signature repeats into one finding with an occurrence count. Only the first
  // sighting of a signature becomes a finding; repeats emit a throttled informational
  // note so a per-render error flood cannot swamp the Errors tab or the saved history.
  private async reportRuntimeFault(
    page: Page,
    source: RuntimeObservation['source'],
    rawMessage: string,
    stack?: string,
    faultAtMs: number = Date.now(),
  ): Promise<void> {
    const t = this.deps.telemetry;
    // Keep the human diagnostic line and the stack frames in separate fields — a console
    // error often arrives as one blob (message + "at …" frames), so splitting it means
    // the finding shows a clean reason and the stack renders on its own.
    const { message, stackTrace } = separateMessageAndStack(rawMessage, stack);
    const url = page.url();
    // Media-playback faults are an environment artifact: Playwright's codec-less Chromium rejects
    // H.264/AAC that real Chrome decodes. Suppress across every channel (the console handler filters
    // earlier; this also catches pageerror/rejection) as informational telemetry — never a bug.
    if (isMediaPlaybackError(message)) {
      t.emit('ACTION', {
        actionExecuted: 'media-fault-suppressed',
        message: `Media playback fault suppressed (codec-less browser env): ${message}`,
      });
      return;
    }
    const timestamp = new Date().toISOString();
    const breadcrumbs = this.deps.getBreadcrumbs();
    const faultType: FaultType = source === 'CONSOLE' ? 'CONSOLE' : 'EXCEPTION';
    const forensicType = source === 'CONSOLE' ? ForensicErrorType.CONSOLE_ERROR : ForensicErrorType.JS_EXCEPTION;

    // Two-or-more distinct controls acted at the fault instant → the thrower can't be isolated;
    // decline single-control attribution and let the burst macro narrate the repro (mirrors the
    // network path's culpritForRequest). A captured non-JSON response is the only evidence that
    // turns a "not valid JSON" parse into a real API-contract break — resolve both once here.
    const burstAmbiguous = this.deps.isConcurrentBurstAt?.(faultAtMs) ?? false;
    const contract = this.contractCorrelator.correlate(faultAtMs);

    // Freeze the rolling buffer and minimize it to the steps causally required to reach
    // this fault before anything else can advance it (see the network handlers). faultAtMs
    // is the true in-page instant for rejections (async event → node hook adds latency).
    const reproduction = ActiveScenarioTracker.flushSnapshot({
      faultUrl: url,
      faultAtMs,
      culpritSelector: burstAmbiguous ? undefined : this.culpritSelectorAt(faultAtMs),
    });
    const reproductionPlaybook = reproduction.narrative;
    // Snapshot client state so cross-page-state faults reproduce during replay.
    const stateFingerprint = await captureStateFingerprint(page);

    // A fault whose root cause is not the target app (harness/driver/browser/env) is
    // demoted to informational telemetry and never registered as a bug.
    // An uncaught page exception / rejection / renderer crash is first-party proof the
    // app itself threw — the strongest possible runtime signal. Floor its confidence at
    // CONFIRMED so a genuine, provenance-cleared fault reads as a confirmed finding, not
    // an under-evidenced one. CONSOLE output is not proof the app threw, but an error-level
    // line IS a real runtime signal — floor it at SIGNAL so a genuine, provenance-cleared,
    // single-shot console error clears the reporting threshold instead of dropping as
    // INCONCLUSIVE. The floor only ever raises: a matched-signal or oracle-CONFIRMED console
    // fault keeps its stronger confidence.
    const verdict = this.verifyFault(faultType, message, {
      url,
      content: stackTrace,
      evidence: { hasMessage: true, hasStackTrace: Boolean(stack), hasReproductionSteps: reproductionPlaybook.length > 0 },
      confidenceFloor: source === 'CONSOLE' ? 'SIGNAL' : 'CONFIRMED',
      contractCorrelated: Boolean(contract),
    });
    const { severity, attribution } = verdict;
    if (!verdict.report) {
      t.emit('ACTION', {
        actionExecuted: 'unverified-runtime-fault',
        message: `Unverified runtime fault suppressed (${attribution.origin}): ${verdict.reason}`,
      });
      return;
    }

    // The app threw: any network failure parked in the correlation window is now a
    // proven UI-breaking fault and is promoted alongside this one. Done before the
    // dedup collapse below — a recurring exception still proves the request broke it.
    await this.promotePendingNetworkFaults(faultAtMs);

    // Classify into a subtype + student-friendly remediation and dedup by signature.
    const { finding, isNew } = this.runtimeFinder.classify({ source, message, stack: stackTrace || stack, url, timestampMs: faultAtMs, contractCorrelated: Boolean(contract) });

    // Collapse: a repeat of an already-reported signature never re-registers a bug.
    // Surface it as a throttled informational note so the recurrence stays visible.
    if (!isNew) {
      // If the first sighting was off-target collateral (no selector), let this better-
      // attributed recurrence name the culprit the dedup would otherwise keep blank — but never
      // during a burst, where naming one sibling would backfill a wrong culprit.
      const culprit = burstAmbiguous ? undefined : this.culpritSelectorAt(faultAtMs);
      if (culprit) this.deps.upgradeFindingCulprit(finding.bugId, culprit, this.culpritLabelAt(faultAtMs));
      // A verified recurrence of an already-reported signature — push the authoritative
      // running total so the live ×N advances by a real manifestation, not by telemetry.
      this.deps.recordFindingOccurrence(finding.bugId, finding.occurrence);
      if (finding.occurrence === 2 || finding.occurrence % 25 === 0) {
        t.emit('ACTION', {
          actionExecuted: 'runtime-fault-recurred',
          message: ` ${finding.message} — recurred ${finding.occurrence}× this run`,
        });
      }
      return;
    }

    this.deps.setFreeze();
    // For a JSON.parse contract fault the useful "where" is the endpoint that returned the
    // non-JSON body, not the page the parse threw on. Correlate it; fall back to the page url.
    let routeUrl = url;
    if (attribution.bugClass === 'API_CONTRACT_VIOLATION' && contract) routeUrl = contract.url;
    // Same evidence contract as every other promotion path: steps, CWE, remediation.
    const complete = ensureFindingEvidence({
      attribution,
      advice: finding.studentAdvice,
      reproductionPlaybook,
      context: url,
    });
    // Record that this fault was attributed to a concurrent burst, not a single control, so the
    // card can show the burst provenance instead of implying one button was proven the culprit.
    if (burstAmbiguous) complete.attribution.routingReason = 'concurrent-burst';
    const remediation = complete.advice;
    const reason = finding.message;
    // Best-effort source-map resolution of the raw stack's top frames (undefined
    // when the target ships no reachable maps).
    const resolver = this.getResolver(page);
    const resolvedStackTrace = await resolver.resolve(stackTrace || stack);
    // The failing handler/component from the top application stack frame — used to
    // attribute the fault when no descriptive DOM control was the trigger.
    const stackCulprit = await resolver.resolveTopAppFrame(stackTrace || stack);

    t.emit('EXCEPTION', {
      message: ` ${finding.message}`,
      exceptionDetails: { message, stackTrace },
      reproductionSteps: complete.reproductionPlaybook,
      attribution: complete.attribution,
    });

    // A tab crash or a stack overflow leaves the page unusable → CRITICAL. Any other
    // uncaught fault (we floored its confidence to CONFIRMED above) takes the MEDIUM
    // RUNTIME_STABILITY_EXCEPTION bug-class default — one uncaught error often leaves the
    // page usable, so it stays MEDIUM unless a 5xx escalates it. CONSOLE output keeps the
    // conservative classifier severity.
    const severityBase = CRITICAL_RUNTIME_SUBTYPES.has(finding.subtype)
      ? 'CRITICAL'
      : source === 'CONSOLE'
        ? severity
        : undefined;
    const faultSeverity = resolveSeverity({
      severity: severityBase,
      bugClass: complete.attribution.bugClass,
      confidence: complete.attribution.confidence,
      verificationStatus: complete.attribution.verificationStatus,
    });

    // A render/console fault often has no genuinely-acted control; culprit resolution
    // then falls back to an incidental last-interaction label (a bare <tag> or an input's
    // value). Prefer a descriptive acted control; otherwise attribute to the failing
    // handler from the stack, never a wrong last-clicked control. Selector stays empty
    // for a stack attribution — a frame is not a DOM selector.
    const rawCulpritLabel = this.culpritLabelAt(faultAtMs);
    const descriptiveLabel = isDescriptiveControlName(rawCulpritLabel) ? rawCulpritLabel : undefined;
    const { culpritLabel, culpritSelector } = resolveRuntimeCulprit({
      burstAmbiguous,
      descriptiveLabel,
      selector: this.culpritSelectorAt(faultAtMs),
      stackCulprit,
    });
    t.gateway.emitIncidentReport({
      bugId: finding.bugId,
      occurrences: finding.occurrence,
      timestamp,
      reason,
      url: routeUrl,
      stackTrace,
      steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
      reproductionActions: reproduction.actions,
      stateFingerprint,
      reproductionPlaybook: complete.reproductionPlaybook,
      advice: remediation,
      attribution: complete.attribution,
      severity: faultSeverity,
      resolvedStackTrace,
      culpritSelector,
      culpritLabel,
    });

    t.gateway.emitForensicReport({
      bugId: finding.bugId,
      occurrences: finding.occurrence,
      timestamp,
      reason,
      url: routeUrl,
      stackTrace,
      breadcrumbs,
      reproductionActions: reproduction.actions,
      stateFingerprint,
      reproductionPlaybook: complete.reproductionPlaybook,
      advice: remediation,
      attribution: complete.attribution,
      severity: faultSeverity,
      resolvedStackTrace,
      culpritSelector,
      culpritLabel,
    });

    // Persist to forensic_errors so saved history mirrors the live Errors tab.
    this.deps.persistForensicError({
      type: forensicType,
      severity: FAULT_TO_FORENSIC[faultSeverity],
      message: ` ${finding.message}`,
      stackTrace,
      url: routeUrl,
      bugClass: complete.attribution.bugClass,
      scenario: complete.attribution.scenario,
      cwe: complete.attribution.cwe,
    });

    // Register the confirmed bug under the finder's stable, signature-derived id so a
    // re-run of the same logical error stays one finding instead of flooding the ledger.
    this.deps.registerConfirmedBug({
      bugId: finding.bugId,
      type: 'EXCEPTION',
      message: finding.message,
      selector: culpritSelector ?? '',
      elementLabel: culpritLabel,
      url: routeUrl,
      payloadUsed: source,
      advice: remediation,
      stackTrace,
      resolvedStackTrace,
      reproductionSteps: complete.reproductionPlaybook,
      reproductionActions: reproduction.actions,
      stateFingerprint,
      attribution: complete.attribution,
      severity: faultSeverity,
      occurrences: finding.occurrence,
      timestamp: new Date(timestamp),
      streamed: true, // already emitted to the Errors tab above
    });
  }

  /** Monitor uncaught JS exceptions, error-level console output, and unhandled rejections. */
  public attachExceptionMonitoring(page: Page): void {
    // Uncaught JavaScript exceptions.
    page.on('pageerror', (error: Error) => {
      void this.reportRuntimeFault(page, 'EXCEPTION', error?.message ?? 'Unknown page error', error?.stack);
    });

    // Error-level console output. Network-stack console errors are skipped — they are
    // already covered by response/requestfailed monitoring.
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (isIgnorableConsoleError(text)) return;
      void this.reportRuntimeFault(page, 'CONSOLE', text);
    });

    // Silent unhandled promise rejections — captured in-page and forwarded through the
    // same pipeline. The exposed binding + init script are re-installed per page; the
    // catch handles the already-bound error thrown when a page is recreated.
    page
      .exposeFunction('__bugsafariOnUnhandledRejection', (payload: { message?: string; stack?: string; at?: number }) => {
        // Prefer the in-page capture instant so the causal snapshot isn't skewed by
        // the async event → node-hook delivery latency. Both clocks are this machine's.
        const at = typeof payload?.at === 'number' && Number.isFinite(payload.at) ? payload.at : Date.now();
        void this.reportRuntimeFault(page, 'REJECTION', payload?.message ?? 'Unhandled promise rejection', payload?.stack, at);
      })
      .catch(() => undefined);
    page
      .addInitScript(() => {
        window.addEventListener('unhandledrejection', (event) => {
          try {
            const reason = (event as PromiseRejectionEvent).reason as { message?: string; stack?: string } | undefined;
            const message = reason?.message ? String(reason.message) : String(reason ?? 'Unhandled promise rejection');
            const stack = reason?.stack ? String(reason.stack) : undefined;
            const hook = (window as unknown as { __bugsafariOnUnhandledRejection?: (p: unknown) => void }).__bugsafariOnUnhandledRejection;
            hook?.({ message, stack, at: Date.now() });
          } catch {
            // never let the reporter hook throw inside the page
          }
        });
      })
      .catch(() => undefined);
  }

  /**
   * Attach fault + console capture to a secondary page the target opened itself
   * (window.open / target=_blank popup). These pages are NOT driven by the
   * explorer, but their uncaught exceptions, rejections, crashes, and console
   * output must still surface as findings — otherwise an error on an app-opened
   * tab is invisible. Network monitoring is deliberately excluded (its watchdog is
   * single-page-scoped on the main run page).
   */
  public async attachSecondaryPage(page: Page): Promise<void> {
    this.attachDialogHandler(page);
    this.attachExceptionMonitoring(page);
    this.attachCrashMonitoring(page);
    await setupBrowserConsoleListener(page, this.deps.telemetry.gateway);
  }

  /** Capture renderer/tab crashes (OOM / GPU fault) directly instead of only inferring them via the freeze heartbeat. */
  public attachCrashMonitoring(page: Page): void {
    page.on('crash', () => {
      this.handleRendererCrash(page);
    });
  }

  // A renderer crash is never a target finding: under memory pressure it is a harness OOM,
  // otherwise a browser/GPU/driver environment fault. Both abort the run with the right
  // remediation instead of blaming the target application.
  private handleRendererCrash(_page: Page): void {
    const pressure = sampleMemoryPressure();
    if (pressure.underPressure) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: HARNESS_RESOURCE_ABORT,
        message: `BugSafari ran out of memory and stopped this run to stay safe (${pressure.detail}). This is a harness limit, not a target defect. Actions: raise the container memory limit, lower run concurrency, or free host memory, then re-run.`,
      });
      this.deps.abortForHarnessFault('memory', pressure.detail);
      return;
    }
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: HARNESS_CRASH_DEMOTED,
      message: `Renderer crashed with no memory pressure (${pressure.detail}) — treated as a browser/GPU/driver environment fault, not a target defect. Demoted, not reported as a finding.`,
    });
    this.deps.abortForHarnessFault('environment', pressure.detail);
  }

  // Proactive memory watchdog. Unlike handleRendererCrash (which samples memory only AFTER
  // the renderer is already OOM-killed), this polls live cgroup usage during the run and
  // aborts gracefully once usage crosses the watchdog threshold — before the container kills
  // the browser. Latch-once: the first crossing fires a single harness-resource abort, the
  // same terminating path the crash handler uses. `sample` is injectable for tests.
  public armMemoryWatchdog(intervalMs: number = MEMORY_WATCHDOG_TICK_MS, sample: () => AdaptiveMemory = sampleAdaptiveMemory): void {
    if (this.memoryWatchdogTimer) clearInterval(this.memoryWatchdogTimer);
    this.memoryAbortFired = false; // fresh watch — a reused monitor instance must re-arm the latch
    this.memoryDegradeFired = false;

    this.memoryWatchdogTimer = setInterval(() => {
      if (this.memoryAbortFired || this.deps.isEngineStopping()) return;
      const mem = sample();

      // Lower tier: shed reclaimable load ONCE (screencast throttle, gc) and keep
      // polling — no abort, no dispose. A recovery to 'ok' lets the run finish.
      if (mem.tier === 'degrade') {
        if (this.memoryDegradeFired) return;
        this.memoryDegradeFired = true;
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'harness-memory-degrade',
          message: `BugSafari is under memory pressure and is shedding load to protect the run (${mem.detail}). Live feed quality was reduced; testing continues.`,
        });
        this.deps.onMemoryDegrade?.(mem.detail);
        return;
      }

      if (mem.tier !== 'abort') return;
      this.memoryAbortFired = true;
      this.disposeMemoryWatchdog();
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: HARNESS_RESOURCE_ABORT,
        message: `BugSafari is approaching its memory limit and is stopping this run to stay safe (${mem.detail}). This is a harness limit, not a target defect. Actions: raise the container memory limit, lower run concurrency, or free host memory, then re-run.`,
      });
      this.deps.abortForHarnessFault('memory', mem.detail);
    }, intervalMs);
    this.memoryWatchdogTimer.unref?.();
  }

  public disposeMemoryWatchdog(): void {
    if (this.memoryWatchdogTimer) clearInterval(this.memoryWatchdogTimer);
    this.memoryWatchdogTimer = undefined;
  }

  // Stable per-request id, allocated lazily so only requests we actually observe cost one.
  private requestIdFor(request: Request): string {
    const existing = this.requestIds.get(request);
    if (existing) return existing;
    this.requestIdSeq += 1;
    const id = `req-${this.requestIdSeq}`;
    this.requestIds.set(request, id);
    return id;
  }

  // Request headers are needed for idempotency-key detection; Playwright can throw once
  // the request is detached, so failure degrades to "no headers" rather than a lost settlement.
  private safeHeaders(request: Request): Record<string, string> | undefined {
    try {
      return request.headers();
    } catch {
      return undefined;
    }
  }

  // Feed one settled request to the duplicate finder and report whatever verdict it produces.
  private settleDuplicateCandidate(page: Page, request: Request, status: number | undefined, failed: boolean): void {
    try {
      // A request that failed because the network is down is not a double-submit
      // missing-guard defect — don't judge duplicates while the target is degraded.
      if (NetworkQuarantine.isDegraded()) return;
      // Lookup-only: a request the duplicate finder never saw has no id and nothing to settle.
      const requestId = this.requestIds.get(request);
      if (!requestId) return;
      const result = this.duplicateFinder.observeSettlement({
        requestId,
        status,
        failed,
        timestampMs: Date.now(),
      });
      if (result) void this.reportDuplicateAction(page, result.defect, result.isNew, result.upgraded);
    } catch {
      // never let the reporter hook throw inside a page listener
    }
  }

  // Report one judged duplicate state-changing request. Direct emit — the knowledge-base
  // classifier has no path to SPA_STATE_RACE_CONDITION, and the finder's two-phase
  // response validation already self-gates, so this bypasses verifyFault and reports with
  // the finder's stable, signature-derived bugId. A recurrence re-registers under the same
  // bugId so the persisted record carries the final occurrence count and verdict.
  private async reportDuplicateAction(page: Page, defect: DuplicateActionDefect, isNew: boolean, upgraded: boolean): Promise<void> {
    const t = this.deps.telemetry;
    const url = defect.endpoint || page.url();
    const timestamp = new Date().toISOString();
    const breadcrumbs = this.deps.getBreadcrumbs();
    const stackTrace = defect.evidence.join('\n');

    // The backend correctly protected the duplicate (rejected 409/425/429, or deduped a
    // shared idempotency key). The app behaved as designed, so surface it as a Network
    // observation only and never register a SPA_STATE_RACE_CONDITION finding.
    if (defect.protected) {
      t.emit('NETWORK', {
        url,
        method: defect.method,
        message: ` ${defect.message}`,
        severity: 'INFO',
      });
      return;
    }

    const reproduction = ActiveScenarioTracker.flushSnapshot({
      faultUrl: url,
      faultAtMs: Date.now(),
      culpritSelector: defect.selector || undefined,
    });
    // The finder's causal pair IS the reproduction — deterministic, two-request steps.
    // The scenario narrative is a multi-control spam burst ("Click 5 controls at once")
    // that a human can't replay, so it is deliberately NOT woven into a duplicate finding.
    const reproductionPlaybook = defect.reproductionHint;
    // Always use the defect-built deterministic replay — never the burst-polluted
    // rolling-buffer snapshot, which lists co-clicked distinct controls (incl. nav links)
    // that cannot reproduce a single-endpoint duplicate. With a known culprit it double-fires
    // that ONE control; with no culprit (ambiguous concurrent burst) it anchors to the
    // repeated endpoint instead. Either way the replay stays consistent with the Message.
    const reproductionActions = buildDuplicateReplaySteps(defect, defect.pageUrl ?? page.url(), timestamp);
    const stateFingerprint = await captureStateFingerprint(page);

    const scenario = resolveScenarioAttribution(ActiveScenarioTracker.getActiveScenarioName());
    // Status from the finder's own score via the single grading source, so the shown
    // label can never disagree with the shown confidence percentage.
    const verificationStatus = statusForScore(defect.confidenceScore, 'TARGET_APP').status;
    const severity = resolveSeverity({
      severity: defect.severity,
      bugClass: defect.bugClass,
      confidence: defect.faultConfidence,
      verificationStatus,
      statusCode: defect.secondStatus,
    });
    // Same contract as every promotion path: steps + CWE + remediation, filled from
    // the knowledge base when this self-gating finder left one of them empty.
    const complete = ensureFindingEvidence({
      attribution: {
        bugClass: defect.bugClass,
        cwe: defect.cwe,
        scenario: scenario.scenario,
        testingType: scenario.testingType,
        stepIndex: reproduction.actions.length,
        origin: 'TARGET_APP',
        confidence: defect.faultConfidence,
        confidenceScore: defect.confidenceScore,
        verificationStatus,
        corroborated: defect.corroborated,
      },
      advice: defect.advice,
      reproductionPlaybook,
      context: `${defect.method} ${url}`,
    });
    const attribution: FindingAttribution = complete.attribution;
    // Human name of the double-fired control, resolved from the finder's own label so
    // live Telemetry and saved history name the same Element (not a bare <tag>). No
    // acted control ⇒ name the repeated endpoint itself so the Element is never blank.
    const resolvedDupLabel = defect.selector
      ? resolveControlName({ label: defect.elementLabel, selector: defect.selector })
      : undefined;
    const culpritLabel = isDescriptiveControlName(resolvedDupLabel)
      ? (resolvedDupLabel as string)
      : `${defect.method} ${url}`;

    t.emit('NETWORK', {
      url,
      method: defect.method,
      message: ` ${defect.message}`,
      // GUARDED duplicates are suppressed above; anything reaching here is an unguarded repeat.
      severity: 'WARNING',
      attribution,
    });

    // A recurrence is already a known finding — refresh the ledger, but keep the live
    // feed quiet beyond a periodic heartbeat so a burst can never flood it.
    if (!isNew) {
      // A later, better-correlated pair fills a culprit the first sighting left
      // blank — first-wins dedup otherwise locks in the empty selector. The
      // runtime- and network-fault paths already do this; the duplicate path
      // did not, so a double-submit first seen during an uncorrelated burst
      // (path replay, a finder driving the page) stayed permanently unattributed.
      if (defect.selector) this.deps.upgradeFindingCulprit(defect.bugId, defect.selector);
      // Push the authoritative real-manifestation count (engine-injected stress excluded)
      // so a genuine repeat double-submit advances the ×N, but a race-scenario burst does not.
      this.deps.recordFindingOccurrence(defect.bugId, defect.manifestations);
      // A stronger verdict (SUSPECTED → CONFIRMED once the control correlates) must patch
      // the already-emitted card by bugId — re-emitting the incident would spawn a second
      // card (the live buffer keys on message content, which changed with the verdict). The
      // ledger severity is refreshed by registerConfirmedBug below; this syncs the card.
      if (upgraded) {
        t.gateway.emitFindingUpgrade?.({
          bugId: defect.bugId,
          severity,
          // Same shape as the emitted incident's reason (no leading space) so the badge tag
          // still parses after the patch.
          message: defect.message,
          confidence: defect.faultConfidence,
          confidenceScore: defect.confidenceScore,
          verificationStatus,
        });
      }
      if (defect.occurrence === 3 || defect.occurrence % 25 === 0) {
        t.emit('ACTION', {
          actionExecuted: 'duplicate-action-recurred',
          message: ` ${defect.message} — recurred ${defect.occurrence}× this run`,
        });
      }
    } else {
      t.emitMilestone(` Duplicate action: ${defect.method} ${url}`);

      t.gateway.emitIncidentReport({
        bugId: defect.bugId,
        occurrences: defect.manifestations,
        timestamp,
        reason: defect.message,
        url,
        stackTrace,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionActions,
        stateFingerprint,
        reproductionPlaybook: complete.reproductionPlaybook,
        advice: complete.advice,
        attribution,
        severity,
        culpritSelector: defect.selector || undefined,
        culpritLabel,
      });

      t.gateway.emitForensicReport({
        bugId: defect.bugId,
        occurrences: defect.manifestations,
        timestamp,
        reason: defect.message,
        url,
        stackTrace,
        breadcrumbs,
        reproductionActions,
        stateFingerprint,
        reproductionPlaybook: complete.reproductionPlaybook,
        advice: complete.advice,
        attribution,
        severity,
        culpritSelector: defect.selector || undefined,
        culpritLabel,
      });

      this.deps.persistForensicError({
        type: ForensicErrorType.INTERACTION_FAILURE,
        severity: FAULT_TO_FORENSIC[severity],
        message: ` ${defect.message}`,
        stackTrace,
        url,
        endpoint: url,
        method: defect.method,
        statusCode: defect.secondStatus,
        bugClass: defect.bugClass,
        scenario: attribution.scenario,
        cwe: defect.cwe,
      });
    }

    // type is deliberately not NETWORK/ACCESSIBILITY so registerConfirmedBug streams it to the Errors tab.
    this.deps.registerConfirmedBug({
      bugId: defect.bugId,
      type: 'DUPLICATE_ACTION',
      message: defect.message,
      selector: defect.selector,
      elementLabel: culpritLabel,
      payloadUsed: defect.method,
      advice: complete.advice,
      stackTrace,
      reproductionSteps: complete.reproductionPlaybook,
      reproductionActions: reproduction.actions,
      stateFingerprint,
      attribution,
      severity,
      occurrences: defect.manifestations,
      timestamp: new Date(timestamp),
      streamed: true, // already emitted to the Errors tab above
    });
  }

  // Register an in-flight fetch/XHR so the watchdog can later flag it if it never settles.
  private trackPending(request: Request, pageUrl: string): void {
    const rt = request.resourceType();
    if (rt !== 'xhr' && rt !== 'fetch') return;
    // A fire-and-forget telemetry/analytics/beacon that never settles is not a UI hang —
    // never watchdog it, so its pending timeout can't manufacture a false hang diagnostic.
    if (isBackgroundTelemetryUrl(request.url())) return;
    // Long-lived-by-design traffic (Next.js RSC prefetch ?_rsc=, SSE, websocket, streaming/poll)
    // stays pending for seconds without blocking the UI — never watchdog it for PENDING_TIMEOUT.
    if (isLongLivedRequestUrl(request.url(), this.safeHeaders(request))) return;
    if (this.pending.size >= MAX_PENDING) {
      // Evict the request with the least detection value left: one whose sweep budget is
      // exhausted, else one already probed. The oldest never-probed request is the
      // strongest hang candidate, so plain insertion-order eviction discarded exactly
      // what we hunt — it is only the last resort.
      let exhausted: Request | undefined;
      let probed: Request | undefined;
      for (const [req, meta] of this.pending) {
        if (meta.sweeps >= SWEEP_POLICY.maxSweeps) {
          exhausted = req;
          break;
        }
        if (!probed && meta.sweeps > 0) probed = req;
      }
      this.pending.delete(exhausted ?? probed ?? (this.pending.keys().next().value as Request));
    }
    const startMs = Date.now();
    this.pending.set(request, {
      url: request.url(),
      method: request.method(),
      startMs,
      pageUrl,
      ...initialSweepState(startMs, SWEEP_POLICY),
    });
  }

  // Watchdog tick: arm an infinite-loading check for any fetch/XHR pending past its next
  // sweep deadline. A request is re-probed on a widening backoff rather than once, because
  // a spinner frequently renders only after the first probe (the app swaps in its loading
  // state late, or a retry layer re-arms it) — a single 8s check silently missed those.
  // ApiHangFinder dedupes by endpoint+trigger, so re-probes bump an occurrence count
  // instead of emitting duplicate findings.
  private sweepPending(page: Page): void {
    const now = Date.now();
    for (const [request, meta] of this.pending) {
      if (!isSweepDue(meta, now, SWEEP_POLICY)) continue;
      Object.assign(meta, advanceSweep(meta, now, SWEEP_POLICY));
      void this.confirmStuckLoading(
        page,
        {
          trigger: 'PENDING_TIMEOUT',
          url: meta.url,
          method: meta.method,
          pendingMs: now - meta.startMs,
          startMs: meta.startMs,
          pageUrl: meta.pageUrl,
        },
        request,
      );
    }
  }

  // Two-probe persistence check: a loading indicator must survive both probes (recovered-gracefully
  // gate) before the finder emits. Fire-and-forget; a page nav/close mid-probe simply drops the check.
  private async confirmStuckLoading(
    page: Page,
    trigger: { trigger: HangTrigger; url: string; method: string; status?: number; pendingMs?: number; startMs?: number; failureDetail?: string; pageUrl?: string },
    request?: Request,
  ): Promise<void> {
    // Engine shutdown/pause aborts in-flight requests, so a spinner left up by teardown is
    // not an app-side infinite-loading bug — skip the two-probe check during termination.
    if (this.deps.isEngineStopping()) return;
    const key = `${trigger.trigger}::${(trigger.url || '').split('#')[0].toLowerCase()}`;
    if (this.confirming.has(key)) return;
    // A dropped request during a network outage leaves a spinner up for the same
    // reason the network is down — not an app-side infinite-loading bug. Skip it.
    if (NetworkQuarantine.isDegraded()) return;
    this.confirming.add(key);
    try {
      const initial = await this.probeLoadingState(page);
      if (!initial.present) return;
      await page.waitForTimeout(CONFIRM_MS);
      const confirm = await this.probeLoadingState(page);
      // For PENDING_TIMEOUT the request must STILL be hanging after the confirm gap — if it settled
      // mid-probe, the persisting spinner is unrelated to it and this is not a hang caused by this call.
      const stillPending = request ? this.pending.has(request) : undefined;
      const result = this.apiHangFinder.evaluate({
        method: trigger.method,
        url: trigger.url,
        trigger: trigger.trigger,
        failureDetail: trigger.failureDetail ?? '',
        status: trigger.status,
        pendingMs: trigger.pendingMs,
        confirmGapMs: CONFIRM_MS,
        initial,
        confirm,
        scenarioActive: isStressScenarioActive(),
        stillPending,
        timestampMs: Date.now(),
        pageUrl: trigger.pageUrl,
      });
      if (!result) return;
      if (result.isNew) {
        this.emitHangDiagnostic(page, result.diagnostic);
      } else if (result.diagnostic.occurrence === 3 || result.diagnostic.occurrence % 25 === 0) {
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'api-hang-recurred',
          message: ` ${result.diagnostic.message} — recurred ${result.diagnostic.occurrence}× this run`,
        });
      }
    } catch {
      // page navigated/closed mid-probe → drop; the engine health gate handles teardown
    } finally {
      this.confirming.delete(key);
    }
  }

  // Read the live DOM for stuck-loading indicators. Runs in the page context; selector lists are
  // passed as args (browser context can't see Node closures). Never throws — a failed scan is empty.
  private async probeLoadingState(page: Page): Promise<LoadingProbe> {
    try {
      return await page.evaluate(
        ([freezeSelectors, inputSelectors]) => {
          const visible = (el: Element): boolean => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
          };
          const matched: string[] = [];
          for (const sel of freezeSelectors) {
            try {
              if (Array.from(document.querySelectorAll(sel)).some(visible)) matched.push(sel);
            } catch {
              // ignore an invalid selector
            }
          }
          let textLoading = false;
          const leaves = Array.from(document.querySelectorAll('body *')).slice(0, 4000);
          for (const el of leaves) {
            if (el.children.length > 0) continue;
            const text = (el.textContent || '').trim();
            if (text.length > 0 && text.length <= 40 && /\bloading\b|\bplease wait\b/i.test(text) && visible(el)) {
              textLoading = true;
              break;
            }
          }
          if (textLoading) matched.push('text:loading');
          let inputsBlocked = false;
          for (const sel of inputSelectors) {
            try {
              if (document.querySelector(sel)) {
                inputsBlocked = true;
                break;
              }
            } catch {
              // ignore an invalid selector
            }
          }
          const indicators = Array.from(new Set(matched)).sort();
          return { present: indicators.length > 0, indicators, inputsBlocked, signature: indicators.join('|') };
        },
        [[...FREEZE_SELECTORS], [...INPUT_BLOCK_SELECTORS]],
      );
    } catch {
      return { present: false, indicators: [], inputsBlocked: false, signature: '' };
    }
  }

  // Surface a sustained API hang as DIAGNOSTIC telemetry only — a NETWORK-tab line plus a
  // milestone. It is deliberately NOT promoted to a classified finding: normal network or
  // slow-loading delays must never be reported as bugs. The finder's two-probe persistence
  // gate + endpoint/trigger dedup keep the diagnostic line from spamming on transient loads.
  private emitHangDiagnostic(page: Page, diagnostic: HangDiagnostic): void {
    const t = this.deps.telemetry;
    const url = diagnostic.endpoint || page.url();
    t.emit('NETWORK', {
      url,
      method: diagnostic.method,
      message: ` ${diagnostic.message}`,
      severity: diagnostic.severity === 'MEDIUM' ? 'INFO' : 'WARNING',
    });
    t.emitMilestone(` API hang (diagnostic): ${diagnostic.method} ${url}`);
  }

  /**
   * The ONE path from "actionable network fault" to "reported finding". Both the
   * response and the transport-failure handlers funnel through here, so every
   * promoted network finding carries the same evidence contract: reproduction
   * breadcrumbs, a CWE-classified attribution, and remediation guidance.
   *
   * Provenance still runs — it decides WHOSE fault it is and feeds the confidence
   * score — but it can no longer veto a fault the routing tree already proved
   * actionable (an injected chaos failure, or one that broke the UI): those are
   * environment-shaped by construction, and vetoing them was how they got lost.
   */
  private async promoteNetworkFault(evidence: NetworkFaultEvidence, routing: NetworkRoutingVerdict): Promise<void> {
    const t = this.deps.telemetry;
    // While the target is unreachable, a failing request is the outage itself, not an
    // app defect — keep it on the Network tab but never promote it (chaos-injected
    // failures are deliberate and still report).
    if (NetworkQuarantine.isDegraded() && routing.reasonCode !== 'CHAOS_INJECTED') {
      t.emit('NETWORK', {
        statusCode: evidence.statusCode,
        url: evidence.url,
        method: evidence.method,
        message: `Not reported — target network degraded: ${evidence.reason}`,
      });
      return;
    }
    const isHttpFault = evidence.statusCode !== undefined;
    // A 2xx whose body declared an error — routed here as a masked failure.
    const isSoftFail = routing.reasonCode === 'SOFT_FAIL_BODY';
    // The finding's locus: the control that fired the request when one is known, else the
    // failing API endpoint itself (a background/polled call has no acted element). Guarantees
    // the Element cell is never blank on a network finding (requirement: element or endpoint).
    // The endpoint is shown as a clean path (tunnel origin + query stripped), e.g. GET /api/soft-fail.
    const endpointRef = `${evidence.method} ${endpointPath(evidence.url)}`;
    const culpritLabel = evidence.triggeringAction || endpointRef;
    // Headline carries the clean endpoint path so an ephemeral tunnel host never leaks
    // into the finding title; the reason clause is only appended when present (no empty ()).
    const faultMessage = isHttpFault
      ? `HTTP ${evidence.statusCode} ${endpointRef}`
      : `Network request failed: ${endpointRef}${evidence.reason ? ` (${evidence.reason})` : ''}`;
    const playbook = evidence.reproduction.narrative;

    const verification = this.verifyFault('NETWORK', faultMessage, {
      statusCode: evidence.statusCode,
      url: evidence.url,
      content: evidence.bodyContent || evidence.detail,
      softFail: isSoftFail,
      evidence: {
        hasMessage: true,
        hasStatusCode: isHttpFault,
        hasReproductionSteps: playbook.length > 0,
        hasSelector: Boolean(evidence.culpritSelector),
      },
    });

    const forced = routing.reasonCode === 'CHAOS_INJECTED' || routing.reasonCode === 'BROKE_UI';
    if (!verification.report && !forced) {
      t.emit('NETWORK', {
        statusCode: evidence.statusCode,
        url: evidence.url,
        method: evidence.method,
        message: `Not reported as a defect (${verification.attribution.origin}): ${verification.reason}`,
      });
      return;
    }

    // A forced promotion is attributed to the app: it either failed to handle an
    // injected fault or broke the interface when the request died. The routing code
    // travels with the finding so the dashboard re-applies the same decision.
    const attribution: FindingAttribution = {
      ...verification.attribution,
      ...(forced && !verification.report
        ? { origin: 'TARGET_APP' as const, verificationStatus: 'NEEDS_VERIFICATION' as const }
        : {}),
      routingReason: routing.reasonCode,
    };

    // Guarantee the three things a developer needs before this leaves the engine, and
    // fold the concrete endpoint facts into the remediation so it names THIS call
    // rather than reading as a generic checklist (audit M1).
    const complete = ensureFindingEvidence({
      attribution,
      advice: verification.advice,
      reproductionPlaybook: playbook,
      context: `${evidence.method} ${evidence.url}`,
      specifics: {
        method: evidence.method,
        endpoint: endpointPath(evidence.url),
        statusCode: evidence.statusCode,
      },
    });

    const severity =
      routing.tier === 'CRITICAL' && verification.severity !== ForensicErrorSeverity.CRITICAL
        ? ForensicErrorSeverity.HIGH
        : verification.severity;
    // Resolve to the canonical scale: applies the low-confidence/unverified cap while a
    // 5xx still escalates, so live and saved surfaces share one guaranteed severity.
    const displaySeverity = resolveSeverity({
      severity,
      bugClass: complete.attribution.bugClass,
      confidence: complete.attribution.confidence,
      verificationStatus: complete.attribution.verificationStatus,
      statusCode: evidence.statusCode,
    });

    // Only genuine target-app failures move the failed-request metric.
    this.deps.onApiFailure();

    const reportUrl = this.deps.getLastKnownUrl() || evidence.page.url();
    const headline = `${faultMessage} · ${routing.reason}`;
    // Stable id keyed on the fault signature (class/status + method + endpoint), so
    // every repeat of the same failing endpoint collapses into ONE finding instead of
    // flooding the ledger with per-request instances (raw instances stay on the Network tab).
    const endpointKey = `${evidence.method}-${endpointPath(evidence.url)}`;
    const bugId = isSecurityBugClass(complete.attribution.bugClass)
      ? `softfail-${complete.attribution.bugClass}-${endpointKey}`
      : `${isHttpFault ? `http-${evidence.statusCode}` : 'network-failed'}-${endpointKey}`;

    // Collapse: only the first sighting of a signature becomes a finding. Repeats bump
    // an occurrence count and emit a throttled recurrence heartbeat, keeping the Errors/
    // Findings surfaces quiet while the Network tab still records each raw request.
    const priorOccurrence = this.reportedNetworkFaults.get(bugId);
    const occurrence = (priorOccurrence ?? 0) + 1;
    this.reportedNetworkFaults.set(bugId, occurrence);
    if (priorOccurrence !== undefined) {
      // A later, better-attributed sighting can fill a culprit the first (off-target
      // collateral) sighting left empty — first-wins dedup otherwise locks in the blank.
      if (evidence.culpritSelector) this.deps.upgradeFindingCulprit(bugId, evidence.culpritSelector);
      // A verified repeat of this failing endpoint+status — advance the authoritative ×N.
      this.deps.recordFindingOccurrence(bugId, occurrence);
      if (occurrence === 2 || occurrence % 25 === 0) {
        t.emit('ACTION', {
          actionExecuted: 'network-fault-recurred',
          message: ` ${headline} — recurred ${occurrence}× this run`,
        });
      }
      return;
    }

    t.emit('NETWORK', {
      statusCode: evidence.statusCode,
      url: evidence.url,
      method: evidence.method,
      durationMs: evidence.durationMs,
      message: headline,
      reproductionSteps: complete.reproductionPlaybook,
      attribution: complete.attribution,
    });

    t.gateway.emitIncidentReport({
      bugId,
      occurrences: occurrence,
      timestamp: evidence.timestamp,
      reason: headline,
      url: reportUrl,
      statusCode: evidence.statusCode,
      stackTrace: evidence.detail,
      steps: this.deps.breadcrumbsToActionRecords(evidence.breadcrumbs),
      reproductionActions: evidence.reproduction.actions,
      stateFingerprint: evidence.stateFingerprint,
      reproductionPlaybook: complete.reproductionPlaybook,
      advice: complete.advice,
      attribution: complete.attribution,
      severity: displaySeverity,
      culpritSelector: evidence.culpritSelector,
      culpritLabel,
    });

    t.gateway.emitForensicReport({
      bugId,
      occurrences: occurrence,
      timestamp: evidence.timestamp,
      reason: headline,
      url: reportUrl,
      statusCode: evidence.statusCode,
      stackTrace: evidence.detail,
      breadcrumbs: evidence.breadcrumbs,
      reproductionActions: evidence.reproduction.actions,
      stateFingerprint: evidence.stateFingerprint,
      reproductionPlaybook: complete.reproductionPlaybook,
      advice: complete.advice,
      attribution: complete.attribution,
      severity: displaySeverity,
      culpritSelector: evidence.culpritSelector,
      culpritLabel,
    });

    this.deps.persistForensicError({
      type: ForensicErrorType.API_FAILURE,
      severity: FAULT_TO_FORENSIC[displaySeverity],
      message: headline,
      stackTrace: evidence.detail,
      url: reportUrl,
      endpoint: evidence.url,
      method: evidence.method,
      statusCode: evidence.statusCode,
      responseText: (evidence.bodyContent ?? '').slice(0, 500),
      action: evidence.triggeringAction,
      bugClass: complete.attribution.bugClass,
      scenario: complete.attribution.scenario,
      cwe: complete.attribution.cwe,
    });

    this.deps.registerConfirmedBug({
      bugId,
      type: 'NETWORK',
      message: headline,
      selector: evidence.culpritSelector ?? '',
      elementLabel: culpritLabel,
      url: reportUrl,
      statusCode: evidence.statusCode,
      payloadUsed: evidence.method,
      advice: complete.advice,
      stackTrace: evidence.detail,
      reproductionSteps: complete.reproductionPlaybook,
      reproductionActions: evidence.reproduction.actions,
      stateFingerprint: evidence.stateFingerprint,
      attribution: complete.attribution,
      severity: displaySeverity,
      occurrences: occurrence,
      timestamp: new Date(evidence.timestamp),
      streamed: true, // the incident report above already put it on the Errors tab
    });
  }

  // A runtime fault just fired: any network failure parked inside the correlation
  // window is now proven consequential (the call died and the app threw), so it is
  // promoted with the evidence frozen at ITS failure time.
  private async promotePendingNetworkFaults(faultAtMs: number): Promise<void> {
    const claimed = this.networkArbiter.claimCausedBy(faultAtMs);
    for (const evidence of claimed) {
      await this.promoteNetworkFault(
        evidence,
        routeNetworkEvent({
          kind: evidence.statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
          statusCode: evidence.statusCode,
          url: evidence.url,
          resourceType: 'xhr',
          failureText: evidence.reason,
          causedRuntimeFault: true,
        }),
      );
    }
  }

  /** Monitor HTTP responses (>=400 or soft-fail body) and outright request failures. */
  public attachNetworkMonitoring(page: Page): void {
    const t = this.deps.telemetry;

    // Passive double-submit detection: a state-changing request repeated with an identical
    // endpoint+payload inside a tight window means no debounce/disable-on-submit guard fired.
    page.on('request', (request: Request) => {
      try {
        const startedAt = Date.now();
        this.requestStartTimes.set(request, startedAt);
        this.trackPending(request, page.url());
        this.duplicateFinder.observeRequest({
          requestId: this.requestIdFor(request),
          method: request.method(),
          url: request.url(),
          body: request.postData() ?? undefined,
          headers: this.safeHeaders(request),
          raceScenarioActive: isRaceScenarioActive(),
          timestampMs: startedAt,
          // Decline attribution during a concurrent DISTINCT-control burst — the click→request
          // link is not captured, so naming one sibling would be a guess (mirrors the
          // network-fault culprit path). An empty culprit then routes the finding to an
          // endpoint-anchored reproduction instead of a wrong/whole-burst snapshot.
          interaction: this.deps.isConcurrentBurstAt?.(startedAt)
            ? undefined
            : this.deps.getInteractionContext(startedAt) ?? undefined,
          pageUrl: page.url(),
        });
      } catch {
        // never let the reporter hook throw inside a page listener
      }
    });

    // Infinite-loading watchdog: a settled request leaves the pending registry; the interval
    // sweeps for any fetch/XHR still pending past the hang threshold and confirms via DOM probe.
    page.on('requestfinished', (request: Request) => this.pending.delete(request));
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => this.sweepPending(page), WATCHDOG_TICK_MS);
    this.watchdogTimer.unref?.();
    page.on('close', () => {
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
      this.pending.clear();
    });

    // Surface routing is decided by the shared decision tree (shared/types/
    // telemetryRouting.ts), the same one the dashboard and the RouteTrasher use:
    //   • Asset noise (favicon/image/font/bundle) → dropped entirely.
    //   • Defensive 4xx, CORS blocks, plain successes → Network tab only.
    //   • 5xx, an error payload masked behind a 2xx, or a chaos-injected failure
    //     → Finding, with full forensic detail.
    page.on('response', async (response: Response) => {
      const status = response.status();
      const url = response.url();
      const method = response.request().method();
      const resourceType = response.request().resourceType();

      // The target answered at all (any status) — it's reachable, so clear the
      // transport-failure streak and lift any browser-view quarantine.
      if (this.isTargetOriginUrl(url)) this.noteTargetReachable();

      // Settle the request in the hang registry; a 5xx fetch/XHR also arms an infinite-loading check.
      this.pending.delete(response.request());
      this.settleDuplicateCandidate(page, response.request(), status, false);
      if (status >= 500 && (resourceType === 'xhr' || resourceType === 'fetch')) {
        void this.confirmStuckLoading(page, { trigger: 'SERVER_ERROR', url, method, status, pageUrl: page.url(), startMs: this.requestStartTimes.get(response.request()) });
      }

      // Full network log (Network tab): record every meaningful request, any status.
      // The response travels so the raw row can carry its headers + trace id.
      this.recordNetworkLog(response.request(), status, status < 400, { response });

      // Asset chatter (missing favicon, lazy image 404) never reaches the classifier.
      if (routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: status, url, resourceType }).reasonCode === 'ASSET_NOISE') {
        return;
      }

      // Cascade tracking on the raw failure — a filtered 404 still costs real network-stack work.
      if (status >= 400) {
        this.deps.recordNetworkFailure();
      }

      // Soft-fail detection: a <400 response whose body flags an error is a
      // masked backend failure. Only the body of an otherwise-successful response
      // is read (a 4xx/5xx is classified by status alone, as before).
      let softFailBody = false;
      let softFailEvidence = '';
      let graphqlErrorResponse = false;
      let bodyContent = '';
      // Only API traffic is body-scanned: reading every 2xx (bundles, documents,
      // media) cost a full buffer per response and risked matching source text.
      if (status < 400 && isBodyReadableResourceType(resourceType)) {
        try {
          bodyContent = await response.text().catch(() => '');
          // Also match server-error signatures (stack traces, "internal server
          // error", SQL/exception text) leaking into a 2xx body — folded in from
          // the former background monitor so that coverage isn't lost by dedup.
          const serverSignature = bodyContent.length <= MAX_SOFT_FAIL_BODY_BYTES && matchesCategory('SERVER_ERROR', bodyContent);
          // Finalize: a masked failure minus expected rejections and normal GraphQL 200
          // error responses; a server-error signature overrides both suppressions.
          const masked = resolveMaskedFailure({ url, body: bodyContent, serverSignature });
          softFailBody = masked.softFail;
          softFailEvidence = masked.matched ?? '';
          graphqlErrorResponse = masked.graphqlInformational;
          // A 2xx API body that is HTML/non-JSON is the classic contract-mismatch source: the
          // app's fetch().json() will throw on it. Park it so a later client JSON.parse fault
          // can name this endpoint as its route (see correlateContractResponse).
          if (looksNonJsonBody(bodyContent)) {
            this.contractCorrelator.record(url, method, this.requestSettledAtMs(response.request()));
          }
        } catch {
          // Ignore body parse errors
        }
      } else if (status >= 400 && isBodyReadableResourceType(resourceType)) {
        // Read the failing API body so a leaked SQL/Mongo/stack signature reaches the
        // classifier, which promotes a raw datastore error to SQL/NoSQL injection instead
        // of collapsing it to a generic server failure. Bounded; bundles/media excluded.
        bodyContent = (await response.text().catch(() => '')).slice(0, MAX_SOFT_FAIL_BODY_BYTES);
      }

      // A clean success with no soft-fail body is not actionable — never emitted,
      // stored, or persisted. Only failures reach the Network tab (below).
      if (status < 400 && !softFailBody) {
        // A valid HTTP 200 GraphQL response carrying field-level errors is normal
        // GraphQL, not a masked failure — keep it visible as informational Network
        // telemetry, never a finding.
        if (graphqlErrorResponse) {
          t.emit('NETWORK', {
            statusCode: status,
            url,
            method,
            durationMs: this.computeRequestDuration(response.request()),
            message: `HTTP ${status} ${method} ${url} — GraphQL response with errors (normal GraphQL; informational)`,
          });
        }
        return;
      }

      // A tunnel/proxy EDGE gateway error (a Cloudflare 502/503/504 error page or a 520–527
      // synthesized when the origin dropped/was unreachable) is infrastructure noise, not an
      // app fault — the proxy in front of the target emitted it, never the target's backend.
      // Runs that explore through a tunnel (SSRF guard) would otherwise report every origin
      // connection-drop as a phantom "Server API Failure". Demote to a Network-tab row; a
      // genuine origin 5xx (the app's own body) has no edge signature and still promotes.
      if (isProxyGatewayArtifact(status, bodyContent)) {
        t.emit('NETWORK', {
          statusCode: status,
          url,
          method,
          durationMs: this.computeRequestDuration(response.request()),
          message: `HTTP ${status} ${method} ${url} — tunnel/proxy gateway error (origin unreachable); not an application fault`,
        });
        return;
      }

      const settledAtMs = this.requestSettledAtMs(response.request());
      const chaosMode = this.chaosModeForRequest(response.request(), url, settledAtMs);
      const verdict = routeNetworkEvent({
        kind: 'HTTP_RESPONSE',
        statusCode: status,
        url,
        resourceType,
        softFailBody,
        chaosInjected: chaosMode !== undefined,
      });

      // Network-tab only: defensive 4xx, CORS blocks, and anything the tree does
      // not consider actionable. Telemetry row, no finding, no persistence, and
      // it is NOT counted as an API failure.
      if (!verdict.promote) {
        t.emit('NETWORK', {
          statusCode: status,
          url,
          method,
          durationMs: this.computeRequestDuration(response.request()),
          message: `HTTP ${status} ${method} ${url} — ${verdict.reason}`,
        });
        return;
      }

      // Actionable: 5xx, an error payload masked behind a 2xx, or a chaos-injected
      // failure. One immutable snapshot, frozen at the moment this response failed,
      // bound identically to the live telemetry and the saved confirmed bug.
      const durationMs = this.computeRequestDuration(response.request());
      const triggeringAction = this.triggeringActionForRequest(response.request());
      const detail = [
        `Request: ${method} ${url}`,
        `Status: HTTP ${status} (${verdict.reason})`,
        durationMs !== undefined ? `Response time: ${durationMs}ms` : undefined,
        `Failure reason: ${softFailEvidence || verdict.reason}`,
        chaosMode ? `Injected fault: ${chaosMode} (BugSafari chaos scenario)` : undefined,
        triggeringAction ? `Triggering action: ${triggeringAction}` : undefined,
        bodyContent ? `Response body (truncated): ${bodyContent.slice(0, 500)}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      await this.promoteNetworkFault(
        {
          page,
          request: response.request(),
          timestamp: new Date().toISOString(),
          faultAtMs: settledAtMs,
          url,
          method,
          reason: verdict.reason,
          detail,
          statusCode: status,
          bodyContent,
          durationMs,
          triggeringAction,
          culpritSelector: this.culpritForRequest(response.request()),
          breadcrumbs: this.deps.getBreadcrumbs(),
          reproduction: ActiveScenarioTracker.flushSnapshot({
            faultUrl: this.deps.getLastKnownUrl() || page.url(),
            faultAtMs: settledAtMs,
            culpritSelector: this.culpritForRequest(response.request()),
          }),
          stateFingerprint: await captureStateFingerprint(page),
          chaosMode,
        },
        verdict,
      );
    });

    // Catch network request failures (timeouts, connection errors, aborts)
    page.on('requestfailed', async (request: Request) => {
      const timestamp = new Date().toISOString();
      const url = request.url();
      const method = request.method();
      const failure = request.failure();
      const reason = failure?.errorText ?? 'Unknown network failure';
      const breadcrumbs = this.deps.getBreadcrumbs();

      // Settle the request in the hang registry regardless of how the failure is classified below.
      this.pending.delete(request);
      this.settleDuplicateCandidate(page, request, undefined, true);

      // NEW: Filter out false-positive ERR_ABORTED errors from user session cancellation
      // When users cancel a Safari session, unresolved HTTP requests are forcefully cancelled
      // These should be demoted to informational ACTION instead of EXCEPTION to prevent dashboard clutter
      const isAborted = isNetworkAbortedError(reason);

      // A genuine (non-abort) fetch/XHR failure arms an infinite-loading check — a dropped call
      // that leaves the spinner up with no error fallback is exactly the fault we want to catch.
      const failedResource = request.resourceType();
      if (!isAborted && (failedResource === 'xhr' || failedResource === 'fetch')) {
        void this.confirmStuckLoading(page, { trigger: 'REQUEST_FAILED', url, method, failureDetail: reason, pageUrl: page.url(), startMs: this.requestStartTimes.get(request) });
      }

      const failedAtMs = this.requestSettledAtMs(request);
      const chaosMode = this.chaosModeForRequest(request, url, failedAtMs);
      const routing = routeNetworkEvent({
        kind: 'TRANSPORT_FAILURE',
        url,
        resourceType: failedResource,
        failureText: reason,
        chaosInjected: chaosMode !== undefined,
      });

      // Static-asset chatter never reaches the Network tab or the failure counters.
      if (routing.reasonCode === 'ASSET_NOISE') return;

      // Cancellations are harness artifacts (session stop, superseded navigation) —
      // logged for context only, never counted, never parked for promotion.
      const cancelled = routing.reasonCode === 'CANCELLED' || (isAborted && !chaosMode);

      // A genuine target-origin transport failure (not a cancel, chaos, or stress
      // abort) counts toward the degradation streak that quarantines false findings.
      if (!cancelled && !chaosMode && !isStressScenarioActive() && this.isTargetOriginUrl(url)) {
        this.noteTargetTransportFailure();
      }

      this.recordNetworkLog(request, undefined, false, { errorText: reason });
      if (!cancelled) this.deps.recordNetworkFailure();

      if (cancelled) {
        if (!isStressScenarioActive()) {
          t.emit('NETWORK', { url, method, message: `${method} ${url} — ${routing.reason}` });
        }
        return;
      }

      // Every transport failure is a Network-tab row, whatever the promotion verdict.
      const failedDurationMs = this.computeRequestDuration(request);
      const triggeringAction = this.triggeringActionForRequest(request);
      t.emit('NETWORK', {
        url,
        method,
        durationMs: failedDurationMs,
        message: `${method} ${url} failed: ${reason} — ${routing.reason}`,
      });

      const evidence: NetworkFaultEvidence = {
        page,
        request,
        timestamp,
        faultAtMs: failedAtMs,
        url,
        method,
        reason,
        detail: [
          `Request: ${method} ${url}`,
          'Status: no response (transport-level failure)',
          failedDurationMs !== undefined ? `Time to failure: ${failedDurationMs}ms` : undefined,
          `Failure reason: ${reason}`,
          chaosMode ? `Injected fault: ${chaosMode} (BugSafari chaos scenario)` : undefined,
          triggeringAction ? `Triggering action: ${triggeringAction}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
        durationMs: failedDurationMs,
        triggeringAction,
        culpritSelector: this.culpritForRequest(request),
        breadcrumbs,
        reproduction: ActiveScenarioTracker.flushSnapshot({
          faultUrl: this.deps.getLastKnownUrl() || page.url(),
          faultAtMs: failedAtMs,
          culpritSelector: this.culpritForRequest(request),
        }),
        stateFingerprint: await captureStateFingerprint(page),
        chaosMode,
      };

      if (routing.promote) {
        await this.promoteNetworkFault(evidence, routing);
        return;
      }

      // Infrastructure/environment failure: Network tab only for now. Parked so that
      // if the app throws because this call died within the correlation window, the
      // arbiter hands it back and it is promoted with THIS evidence (see
      // promotePendingNetworkFaults).
      this.networkArbiter.hold(url, evidence, failedAtMs);
    });
  }

  /**
   * Attach the background instability monitors that require a navigated page:
   * the 5s heartbeat / deep-scan stability monitor (returns a disposer) and the
   * isolated browser-console listener. Returns the stability monitor's cleanup.
   */
  public async attachAfterNavigation(
    page: Page,
    onBugRegistered: StabilityMonitorDeps['registerConfirmedBug'],
  ): Promise<() => void> {
    // ️ Initialize stability monitoring - runs silently in background
    // Monitors System Lock-up (5s heartbeat timeout). Real server outages are
    // caught separately via 5xx/requestfailed/pageerror listeners below.
    const cleanup = setupStabilityMonitoring(page, this.deps.telemetry.gateway, onBugRegistered, () =>
      this.deps.isEngineStopping(),
    );

    // Proactive memory watchdog: run-global, disposed with the heartbeat cleanup so a hung
    // renderer can't outlive it. Stops the run before the container OOM-kills the browser.
    this.armMemoryWatchdog();

    // ️ Setup isolated browser console listener for dedicated Console Tab in dashboard
    // Captures actual browser console.log/warn/info/error without mixing with backend telemetry
    await setupBrowserConsoleListener(page, this.deps.telemetry.gateway);

    return () => {
      cleanup();
      this.disposeMemoryWatchdog();
    };
  }
}

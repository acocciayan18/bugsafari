import type { Dialog, Page, Request, Response } from 'playwright';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { setupStabilityMonitoring } from '../../../infrastructure/monitoring/stabilityMonitor.js';
import { setupBrowserConsoleListener } from '../../../infrastructure/monitoring/browserConsoleListener.js';
import {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../../infrastructure/database/models/ForensicErrorModel.js';
import {
  classifyFault,
  matchesCategory,
  FREEZE_SELECTORS,
  INPUT_BLOCK_SELECTORS,
  type FaultType,
} from '../../../bugs/knowledgeBase/index.js';
import { RuntimeStabilityFinder, type RuntimeObservation } from '../../heuristics/RuntimeStabilityFinder.js';
import { DuplicateActionFinder, type DuplicateActionDefect } from '../../heuristics/DuplicateActionFinder.js';
import { ApiHangFinder, type LoadingProbe, type ApiHangDefect, type HangTrigger } from '../../heuristics/ApiHangFinder.js';
import { resolveScenarioAttribution } from '../../../bugs/knowledgeBase/scenarioCatalog.js';
import { classifyHttpStatus, isExpectedResourceNoise } from '../../scenarios/routeTrasher/routeTrashClassifier.js';
import type { FindingAttribution } from '../../../../../shared/types.js';
import type { StabilityMonitorDeps } from '../exploration/types.js';
import { VerificationPipeline, type VerificationCandidate } from '../verification/index.js';

// Infinite-loading watchdog tunables. A fetch/XHR still pending past HANG_THRESHOLD_MS is a
// hang candidate; CONFIRM_MS is the persistence gap between the two DOM probes; the rest bound cost.
const MAX_PENDING = 300;
const WATCHDOG_TICK_MS = 1000;
const HANG_THRESHOLD_MS = 8000;
const CONFIRM_MS = 2500;

/** Maps the knowledge-base severity scale to the persisted forensic-error scale. */
const SEVERITY_TO_FORENSIC: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', ForensicErrorSeverity> = {
  LOW: ForensicErrorSeverity.LOW,
  MEDIUM: ForensicErrorSeverity.MEDIUM,
  HIGH: ForensicErrorSeverity.HIGH,
  CRITICAL: ForensicErrorSeverity.CRITICAL,
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
  stackTrace = stackTrace.replace(/C:\\Users\\[^\\]+\\/g, '[REDACTED_PATH]/g');
  stackTrace = stackTrace.replace(/C:\/[^\/]+\//g, '[REDACTED_PATH]/g');
  // Unix/Linux paths
  stackTrace = stackTrace.replace(/\/home\/[^\/]+\//g, '[REDACTED_PATH]/g');
  stackTrace = stackTrace.replace(/\/Users\/[^\/]+\//g, '[REDACTED_PATH]/g');

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

  // Remove line/column numbers that could hint at codebase structure
  stackTrace = stackTrace.replace(/:(\d+):(\d+)/g, ':[LINE]:[COL]');

  // Extract just the error type name if present (e.g., "TypeError:", "ReferenceError:")
  const errorTypeMatch = stackTrace.match(/^([A-Za-z]+Error):/);
  const errorType = errorTypeMatch ? errorTypeMatch[1] : 'Error';

  return {
    message: `${errorType}: ${message}`,
    stackTrace,
  };
}

// Remediation is now sourced from the knowledge-base bug catalog via the
// classifier (see classifyAndAttribute); the former buildRemediation() helper was
// removed to keep remediation single-sourced.

// Monotonic sequence guaranteeing every confirmed-bug id is unique even when
// many errors fire within the same millisecond — required so identity-only
// dedup retains every distinct instance instead of merging same-timestamp ones.
let confirmedBugSeq = 0;
function nextBugSeq(): number {
  confirmedBugSeq += 1;
  return confirmedBugSeq;
}

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

  // Passive double-submit detector: collapses identical state-changing request bursts (one per run).
  private readonly duplicateFinder = new DuplicateActionFinder();

  // Infinite-loading detector + the impure edges that feed it: an in-flight fetch/XHR registry,
  // the watchdog interval sweeping it, and a per-endpoint guard against concurrent confirmations.
  private readonly apiHangFinder = new ApiHangFinder();
  private readonly pending = new Map<Request, { url: string; method: string; startMs: number; swept: boolean }>();
  private readonly confirming = new Set<string>();
  private watchdogTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: StabilityMonitorDeps) {}

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
    },
  ): { report: boolean; advice: string; severity: ForensicErrorSeverity; attribution: FindingAttribution; reason: string } {
    const classification = classifyFault({
      faultType,
      message,
      statusCode: opts?.statusCode,
      url: opts?.url,
      content: opts?.content,
      scenario: ActiveScenarioTracker.getActiveScenarioName(),
      stepIndex: ActiveScenarioTracker.getCurrentStepIndex(),
    });

    const outcome = this.verifier.evaluate({
      faultType,
      message,
      confidence: classification.confidence,
      statusCode: opts?.statusCode,
      url: opts?.url,
      content: opts?.content,
      evidence: opts?.evidence,
    });

    const attribution: FindingAttribution = {
      bugClass: classification.bugClass,
      cwe: classification.cwe,
      scenario: classification.scenario,
      testingType: classification.testingType,
      stepIndex: classification.stepIndex,
      origin: outcome.origin,
      confidence: outcome.confidence,
      verificationStatus: outcome.status,
      confidenceScore: outcome.score,
      corroborated: outcome.corroborated,
    };
    return {
      report: outcome.report,
      advice: classification.advice,
      severity: SEVERITY_TO_FORENSIC[classification.severity],
      attribution,
      reason: outcome.reason,
    };
  }

  /** Auto-dismiss native dialogs so they never block exploration. */
  public attachDialogAutoDismiss(page: Page): void {
    const t = this.deps.telemetry;
    page.on('dialog', async (dialog: Dialog) => {
      t.emit('ACTION', {
        actionExecuted: 'dialog-auto-dismiss',
        message: `Auto-dismissed ${dialog.type()} dialog`,
      });
      await dialog.dismiss().catch(() => undefined);
    });
  }

  // Report one JavaScript runtime fault through the full pipeline: verify (classify +
  // provenance-gate + score), then classify into a fine-grained subtype and collapse
  // same-signature repeats into one finding with an occurrence count. Only the first
  // sighting of a signature becomes a finding; repeats emit a throttled informational
  // note so a per-render error flood cannot swamp the Errors tab or the saved history.
  private reportRuntimeFault(
    page: Page,
    source: RuntimeObservation['source'],
    rawMessage: string,
    stack?: string,
  ): void {
    const t = this.deps.telemetry;
    const message = rawMessage || 'Unknown runtime error';
    const stackTrace = stack ?? message;
    const url = page.url();
    const timestamp = new Date().toISOString();
    const breadcrumbs = this.deps.getBreadcrumbs();
    const faultType: FaultType = source === 'CONSOLE' ? 'CONSOLE' : 'EXCEPTION';
    const forensicType = source === 'CONSOLE' ? ForensicErrorType.CONSOLE_ERROR : ForensicErrorType.JS_EXCEPTION;

    // Freeze the rolling buffer and minimize it to the steps causally required to reach
    // this fault before anything else can advance it (see the network handlers).
    const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs: Date.now() });
    const reproductionPlaybook = reproduction.narrative;

    // A fault whose root cause is not the target app (harness/driver/browser/env) is
    // demoted to informational telemetry and never registered as a bug.
    const verdict = this.verifyFault(faultType, message, {
      url,
      content: stackTrace,
      evidence: { hasMessage: true, hasStackTrace: Boolean(stack), hasReproductionSteps: reproductionPlaybook.length > 0 },
    });
    const { severity, attribution } = verdict;
    if (!verdict.report) {
      t.emit('ACTION', {
        actionExecuted: 'unverified-runtime-fault',
        message: `ℹ️ Unverified runtime fault suppressed (${attribution.origin}): ${verdict.reason}`,
      });
      return;
    }

    // Classify into a subtype + student-friendly remediation and dedup by signature.
    const { finding, isNew } = this.runtimeFinder.classify({ source, message, stack, url, timestampMs: Date.now() });

    // Collapse: a repeat of an already-reported signature never re-registers a bug.
    // Surface it as a throttled informational note so the recurrence stays visible.
    if (!isNew) {
      if (finding.occurrence === 2 || finding.occurrence % 25 === 0) {
        t.emit('ACTION', {
          actionExecuted: 'runtime-fault-recurred',
          message: `🔁 ${finding.message} — recurred ${finding.occurrence}× this run`,
        });
      }
      return;
    }

    this.deps.setFreeze();
    const remediation = finding.studentAdvice;
    const reason = finding.message;

    t.emit('EXCEPTION', {
      message: `🔴 ${finding.message}`,
      exceptionDetails: { message, stackTrace },
      reproductionSteps: reproductionPlaybook,
      attribution,
    });

    t.gateway.emitIncidentReport({
      timestamp,
      reason,
      url,
      stackTrace,
      steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
      reproductionPlaybook,
      advice: remediation,
      attribution,
    });

    t.gateway.emitForensicReport({
      timestamp,
      reason,
      url,
      stackTrace,
      breadcrumbs,
      reproductionPlaybook,
      advice: remediation,
      attribution,
    });

    // Persist to forensic_errors so saved history mirrors the live Errors tab.
    this.deps.persistForensicError({
      type: forensicType,
      severity,
      message: `🔴 ${finding.message}`,
      stackTrace,
      url,
      bugClass: attribution.bugClass,
      scenario: attribution.scenario,
      cwe: attribution.cwe,
    });

    // Register the confirmed bug under the finder's stable, signature-derived id so a
    // re-run of the same logical error stays one finding instead of flooding the ledger.
    this.deps.registerConfirmedBug({
      bugId: finding.bugId,
      type: 'EXCEPTION',
      message: finding.message,
      selector: '',
      payloadUsed: source,
      advice: remediation,
      stackTrace,
      reproductionSteps: reproductionPlaybook,
      reproductionActions: reproduction.actions,
      attribution,
      timestamp: new Date(timestamp),
      streamed: true, // already emitted to the Errors tab above
    });
  }

  /** Monitor uncaught JS exceptions, error-level console output, and unhandled rejections. */
  public attachExceptionMonitoring(page: Page): void {
    // Uncaught JavaScript exceptions.
    page.on('pageerror', (error: Error) => {
      this.reportRuntimeFault(page, 'EXCEPTION', error?.message ?? 'Unknown page error', error?.stack);
    });

    // Error-level console output. Network-stack console errors are skipped — they are
    // already covered by response/requestfailed monitoring.
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.includes('net::ERR') || text.includes('ERR_')) return;
      this.reportRuntimeFault(page, 'CONSOLE', text);
    });

    // Silent unhandled promise rejections — captured in-page and forwarded through the
    // same pipeline. The exposed binding + init script are re-installed per page; the
    // catch handles the already-bound error thrown when a page is recreated.
    page
      .exposeFunction('__bugsafariOnUnhandledRejection', (payload: { message?: string; stack?: string }) => {
        this.reportRuntimeFault(page, 'REJECTION', payload?.message ?? 'Unhandled promise rejection', payload?.stack);
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
            hook?.({ message, stack });
          } catch {
            // never let the reporter hook throw inside the page
          }
        });
      })
      .catch(() => undefined);
  }

  /** Capture renderer/tab crashes (OOM / GPU fault) directly instead of only inferring them via the freeze heartbeat. */
  public attachCrashMonitoring(page: Page): void {
    page.on('crash', () => {
      this.reportRuntimeFault(page, 'CRASH', 'Renderer process crashed (out-of-memory or GPU fault)');
    });
  }

  // Report one confirmed duplicate state-changing request. Direct SIGNAL emit — the
  // knowledge-base classifier has no path to SPA_STATE_RACE_CONDITION, and the finder's
  // burst logic already self-gates, so this bypasses verifyFault and reports with the
  // finder's stable, signature-derived bugId (collapse+count keeps it one finding).
  private reportDuplicateAction(page: Page, defect: DuplicateActionDefect): void {
    const t = this.deps.telemetry;
    const url = defect.endpoint || page.url();
    const timestamp = new Date().toISOString();
    const breadcrumbs = this.deps.getBreadcrumbs();

    const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs: Date.now() });
    const reproductionPlaybook = reproduction.narrative;

    const scenario = resolveScenarioAttribution(ActiveScenarioTracker.getActiveScenarioName());
    const attribution: FindingAttribution = {
      bugClass: defect.bugClass,
      cwe: defect.cwe,
      scenario: scenario.scenario,
      testingType: scenario.testingType,
      stepIndex: reproduction.actions.length,
      confidence: 'SIGNAL',
      corroborated: defect.corroborated,
    };

    t.emit('NETWORK', {
      url,
      method: defect.method,
      message: `🟠 ${defect.message}`,
      severity: 'WARNING',
      attribution,
    });
    t.emitMilestone(`🔁 Duplicate action: ${defect.method} ${url}`);

    t.gateway.emitIncidentReport({
      timestamp,
      reason: defect.message,
      url,
      steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
      reproductionPlaybook,
      advice: defect.advice,
      attribution,
    });

    t.gateway.emitForensicReport({
      timestamp,
      reason: defect.message,
      url,
      breadcrumbs,
      reproductionPlaybook,
      advice: defect.advice,
      attribution,
    });

    this.deps.persistForensicError({
      type: ForensicErrorType.API_FAILURE,
      severity: SEVERITY_TO_FORENSIC[defect.severity],
      message: `🟠 ${defect.message}`,
      url,
      endpoint: url,
      method: defect.method,
      bugClass: defect.bugClass,
      scenario: attribution.scenario,
      cwe: defect.cwe,
    });

    // type is deliberately not NETWORK/ACCESSIBILITY so registerConfirmedBug streams it to the Errors tab.
    this.deps.registerConfirmedBug({
      bugId: defect.bugId,
      type: 'DUPLICATE_ACTION',
      message: defect.message,
      selector: '',
      payloadUsed: defect.method,
      advice: defect.advice,
      reproductionSteps: reproductionPlaybook,
      reproductionActions: reproduction.actions,
      attribution,
      timestamp: new Date(timestamp),
      streamed: true, // already emitted to the Errors tab above
    });
  }

  // Register an in-flight fetch/XHR so the watchdog can later flag it if it never settles.
  private trackPending(request: Request): void {
    const rt = request.resourceType();
    if (rt !== 'xhr' && rt !== 'fetch') return;
    if (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value as Request | undefined;
      if (oldest) this.pending.delete(oldest);
    }
    this.pending.set(request, { url: request.url(), method: request.method(), startMs: Date.now(), swept: false });
  }

  // Watchdog tick: arm an infinite-loading check for any fetch/XHR pending past the threshold.
  private sweepPending(page: Page): void {
    const now = Date.now();
    for (const [, meta] of this.pending) {
      if (meta.swept) continue;
      const pendingMs = now - meta.startMs;
      if (pendingMs <= HANG_THRESHOLD_MS) continue;
      meta.swept = true;
      void this.confirmStuckLoading(page, { trigger: 'PENDING_TIMEOUT', url: meta.url, method: meta.method, pendingMs });
    }
  }

  // Two-probe persistence check: a loading indicator must survive both probes (recovered-gracefully
  // gate) before the finder emits. Fire-and-forget; a page nav/close mid-probe simply drops the check.
  private async confirmStuckLoading(
    page: Page,
    trigger: { trigger: HangTrigger; url: string; method: string; status?: number; pendingMs?: number; failureDetail?: string },
  ): Promise<void> {
    const key = `${trigger.trigger}::${(trigger.url || '').split('#')[0].toLowerCase()}`;
    if (this.confirming.has(key)) return;
    this.confirming.add(key);
    try {
      const initial = await this.probeLoadingState(page);
      if (!initial.present) return;
      await page.waitForTimeout(CONFIRM_MS);
      const confirm = await this.probeLoadingState(page);
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
        timestampMs: Date.now(),
      });
      if (!result) return;
      if (result.isNew) {
        this.reportApiHang(page, result.defect);
      } else if (result.defect.occurrence === 3 || result.defect.occurrence % 25 === 0) {
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'api-hang-recurred',
          message: `⏳ ${result.defect.message} — recurred ${result.defect.occurrence}× this run`,
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
            if (text.length > 0 && text.length <= 40 && /loading|please wait/i.test(text) && visible(el)) {
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

  // Report one confirmed infinite-loading fault. Direct SIGNAL emit like reportDuplicateAction —
  // the finder's two-probe persistence check self-gates, so this bypasses verifyFault and reports
  // under INFINITE_LOADING with the finder's stable, signature-derived bugId.
  private reportApiHang(page: Page, defect: ApiHangDefect): void {
    const t = this.deps.telemetry;
    const url = defect.endpoint || page.url();
    const timestamp = new Date().toISOString();
    const breadcrumbs = this.deps.getBreadcrumbs();
    const stackTrace = defect.evidence.join('\n');

    const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs: Date.now() });
    const reproductionPlaybook = reproduction.narrative;

    const scenario = resolveScenarioAttribution(ActiveScenarioTracker.getActiveScenarioName());
    const attribution: FindingAttribution = {
      bugClass: defect.bugClass,
      cwe: defect.cwe,
      scenario: scenario.scenario,
      testingType: scenario.testingType,
      stepIndex: reproduction.actions.length,
      confidence: 'SIGNAL',
      corroborated: defect.corroborated,
    };

    t.emit('NETWORK', {
      url,
      method: defect.method,
      message: `🟠 ${defect.message}`,
      severity: 'WARNING',
      attribution,
    });
    t.emitMilestone(`⏳ API hang: ${defect.method} ${url}`);

    t.gateway.emitIncidentReport({
      timestamp,
      reason: defect.message,
      url,
      stackTrace,
      steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
      reproductionPlaybook,
      advice: defect.advice,
      attribution,
    });

    t.gateway.emitForensicReport({
      timestamp,
      reason: defect.message,
      url,
      stackTrace,
      breadcrumbs,
      reproductionPlaybook,
      advice: defect.advice,
      attribution,
    });

    this.deps.persistForensicError({
      type: ForensicErrorType.TIMEOUT_FAILURE,
      severity: SEVERITY_TO_FORENSIC[defect.severity],
      message: `🟠 ${defect.message}`,
      stackTrace,
      url,
      endpoint: url,
      method: defect.method,
      bugClass: defect.bugClass,
      scenario: attribution.scenario,
      cwe: defect.cwe,
    });

    // type is deliberately not NETWORK/ACCESSIBILITY so registerConfirmedBug streams it to the Errors tab.
    this.deps.registerConfirmedBug({
      bugId: defect.bugId,
      type: 'INFINITE_LOADING',
      message: defect.message,
      selector: '',
      payloadUsed: defect.method,
      advice: defect.advice,
      stackTrace,
      reproductionSteps: reproductionPlaybook,
      reproductionActions: reproduction.actions,
      attribution,
      timestamp: new Date(timestamp),
      streamed: true, // already emitted to the Errors tab above
    });
  }

  /** Monitor HTTP responses (>=400 or soft-fail body) and outright request failures. */
  public attachNetworkMonitoring(page: Page): void {
    const t = this.deps.telemetry;

    // Passive double-submit detection: a state-changing request repeated with an identical
    // endpoint+payload inside a tight window means no debounce/disable-on-submit guard fired.
    page.on('request', (request: Request) => {
      try {
        this.trackPending(request);
        const result = this.duplicateFinder.observeRequest({
          method: request.method(),
          url: request.url(),
          body: request.postData() ?? undefined,
          raceScenarioActive: isRaceScenarioActive(),
          timestampMs: Date.now(),
        });
        if (!result) return;
        if (result.isNew) {
          this.reportDuplicateAction(page, result.defect);
        } else if (result.defect.occurrence === 3 || result.defect.occurrence % 25 === 0) {
          t.emit('ACTION', {
            actionExecuted: 'duplicate-action-recurred',
            message: `🔁 ${result.defect.message} — recurred ${result.defect.occurrence}× this run`,
          });
        }
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

    // Centralized three-tier network classification (see routeTrashClassifier —
    // the single source of truth shared with the RouteTrasher scenario):
    //   • Expected resource noise (favicon/image/font/bundle failures) → ignored.
    //   • Defensive 4xx (400/401/403/404/…) handled gracefully → INFORMATIONAL
    //     telemetry only; NO finding, NO forensic persistence, NOT counted as an
    //     API failure (so it never inflates metrics or triggers recovery).
    //   • 5xx or a soft-fail body masked behind a 2xx → MEDIUM+ backend failure
    //     finding with full forensic detail.
    page.on('response', async (response: Response) => {
      const status = response.status();
      const url = response.url();
      const method = response.request().method();
      const resourceType = response.request().resourceType();

      // Settle the request in the hang registry; a 5xx fetch/XHR also arms an infinite-loading check.
      this.pending.delete(response.request());
      if (status >= 500 && (resourceType === 'xhr' || resourceType === 'fetch')) {
        void this.confirmStuckLoading(page, { trigger: 'SERVER_ERROR', url, method, status });
      }

      // Filter expected browser/network noise (missing static assets, etc.) so a
      // normal 404 favicon/image can never create a false-positive finding.
      if (isExpectedResourceNoise(url, resourceType, status)) {
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
      let bodyContent = '';
      if (status < 400) {
        try {
          bodyContent = await response.text().catch(() => '');
          const bodyLower = bodyContent.toLowerCase();
          const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
          const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));
          // Also match server-error signatures (stack traces, "internal server
          // error", SQL/exception text) leaking into a 2xx body — folded in from
          // the former background monitor so that coverage isn't lost by dedup.
          softFailBody = hasErrorFlag || hasStatusFail || matchesCategory('SERVER_ERROR', bodyContent);
        } catch {
          // Ignore body parse errors
        }
      }

      // A clean success with no soft-fail body is not a fault — nothing to emit.
      if (status < 400 && !softFailBody) {
        return;
      }

      const verdict = classifyHttpStatus(status, { softFailBody });

      // INFORMATIONAL: expected defensive response handled gracefully. Surface it
      // on the Network tab as telemetry only — no finding, no persistence, no
      // confirmed bug, and it is NOT counted as an API failure.
      if (!verdict.createFinding) {
        t.emit('NETWORK', {
          statusCode: status,
          url,
          method,
          message: `🛡️ Defensive response (informational): HTTP ${status} ${method} ${url} — ${verdict.reason}`,
        });
        return;
      }

      // MEDIUM+: genuine backend failure (5xx or masked soft-fail). Candidate finding.
      // One immutable snapshot, frozen at the moment this response failed, bound
      // identically to the live telemetry and the saved confirmed bug. Reading
      // the global rolling buffer twice (once per consumer) risks the live card
      // and the stored record diverging if an action lands between the reads.
      const reproduction = ActiveScenarioTracker.flushSnapshot({
        faultUrl: this.deps.getLastKnownUrl() || page.url(),
        faultAtMs: Date.now(),
      });
      const reproductionPlaybook = reproduction.narrative;
      // Verify before reporting: the response body is scanned for NoSQL/server-error
      // signatures, the 5xx escalates severity, and provenance rejects third-party /
      // environment failures so only genuine target-app backend faults are reported.
      const verification = this.verifyFault('NETWORK', `HTTP ${status} ${method} ${url}`, {
        statusCode: status,
        url,
        content: bodyContent,
        evidence: { hasMessage: true, hasStatusCode: true, hasReproductionSteps: reproductionPlaybook.length > 0 },
      });
      const { advice: remediation, severity, attribution } = verification;
      if (!verification.report) {
        t.emit('NETWORK', {
          statusCode: status,
          url,
          method,
          message: `ℹ️ Unverified backend response suppressed (${attribution.origin}): ${verdict.reason}`,
        });
        return;
      }

      // Phase 3: Track failed requests count (only genuine target-app failures).
      this.deps.onApiFailure();

      t.emit('NETWORK', {
        statusCode: status,
        url,
        method,
        message: `Network ${status} ${method} ${url}`,
        reproductionSteps: reproductionPlaybook,
        attribution,
      });

      // Persist API failure to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.API_FAILURE,
        severity,
        message: `API Failure: HTTP ${status} ${method} ${url}`,
        stackTrace: `HTTP ${status} response from ${url}${bodyContent ? ` - Body: ${bodyContent.slice(0, 500)}` : ''}`,
        url: this.deps.getLastKnownUrl() || page.url(),
        endpoint: url,
        method,
        statusCode: status,
        responseText: bodyContent.slice(0, 500),
        bugClass: attribution.bugClass,
        scenario: attribution.scenario,
        cwe: attribution.cwe,
      });

      // Register HTTP error bug to memory — one distinct instance PER failing
      // response (unique sequenced id), enriched with the stack/body, the
      // replication checklist, and a copyable suggested fix for the drawer.
      this.deps.registerConfirmedBug({
        bugId: `http-${status}-${Date.now()}-${nextBugSeq()}`,
        type: 'NETWORK',
        message: `HTTP ${status} Error: ${method} ${url}`,
        selector: '',
        payloadUsed: method,
        advice: remediation,
        stackTrace: `HTTP ${status} response from ${url}${bodyContent ? ` - Body: ${bodyContent.slice(0, 500)}` : ''}`,
        reproductionSteps: reproductionPlaybook,
        reproductionActions: reproduction.actions,
        attribution,
        timestamp: new Date(),
      });
    });

    // Catch network request failures (timeouts, connection errors, aborts)
    page.on('requestfailed', (request: Request) => {
      const timestamp = new Date().toISOString();
      const url = request.url();
      const method = request.method();
      const failure = request.failure();
      const reason = failure?.errorText ?? 'Unknown network failure';
      const breadcrumbs = this.deps.getBreadcrumbs();

      // Settle the request in the hang registry regardless of how the failure is classified below.
      this.pending.delete(request);

      // NEW: Filter out false-positive ERR_ABORTED errors from user session cancellation
      // When users cancel a Safari session, unresolved HTTP requests are forcefully cancelled
      // These should be demoted to informational ACTION instead of EXCEPTION to prevent dashboard clutter
      const isAborted = isNetworkAbortedError(reason);

      // A genuine (non-abort) fetch/XHR failure arms an infinite-loading check — a dropped call
      // that leaves the spinner up with no error fallback is exactly the fault we want to catch.
      const failedResource = request.resourceType();
      if (!isAborted && (failedResource === 'xhr' || failedResource === 'fetch')) {
        void this.confirmStuckLoading(page, { trigger: 'REQUEST_FAILED', url, method, failureDetail: reason });
      }

      if (isAborted) {
        // During stress scenarios (RouteTrasher, CoordinateBombing, etc.), network aborts
        // are expected and abundant — suppress telemetry spam to keep the feed readable.
        // Only emit ACTION telemetry for aborts during normal exploration.
        if (!isStressScenarioActive()) {
          t.emit('ACTION', {
            actionExecuted: 'network-aborted',
            url,
            method,
            message: `ℹ️ Active network connection closed due to user session abort. ${method} ${url}`,
          });
        }
        // Skip persistent logging for aborts - these are expected cancellation events
        return;
      }

      // Cascade tracking on the raw failure — see the response handler above.
      this.deps.recordNetworkFailure();

      // Process as EXCEPTION for real network failures
      const reproduction = ActiveScenarioTracker.flushSnapshot({
        faultUrl: this.deps.getLastKnownUrl() || page.url(),
        faultAtMs: Date.now(),
      });
      const reproductionPlaybook = reproduction.narrative;
      // Verify before reporting: DNS/TLS/connection failures and third-party hosts
      // are environment artifacts, not target-app defects, and are gated out here.
      const failureDetail = `${method} ${url} - ${reason}`;
      const verdict = this.verifyFault('NETWORK', `Network Request Failed: ${reason}`, {
        url,
        content: failureDetail,
        evidence: { hasMessage: true, hasReproductionSteps: reproductionPlaybook.length > 0 },
      });
      const { advice: remediation, severity, attribution } = verdict;
      if (!verdict.report) {
        if (!isStressScenarioActive()) {
          t.emit('ACTION', {
            actionExecuted: 'unverified-network-failure',
            url,
            method,
            message: `ℹ️ Unverified network failure suppressed (${attribution.origin}): ${verdict.reason}`,
          });
        }
        return;
      }

      t.emit('EXCEPTION', {
        url,
        method,
        message: `Network Request Failed: ${reason} for ${method} ${url}`,
        reproductionSteps: reproductionPlaybook,
        attribution,
      });

      t.gateway.emitIncidentReport({
        timestamp,
        reason: `Network Request Failed: ${reason}`,
        url: this.deps.getLastKnownUrl() || page.url(),
        stackTrace: failureDetail,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionPlaybook,
        advice: remediation,
        attribution,
      });

      t.gateway.emitForensicReport({
        timestamp,
        reason: `Network Request Failed: ${reason}`,
        url: this.deps.getLastKnownUrl() || page.url(),
        stackTrace: failureDetail,
        breadcrumbs,
        reproductionPlaybook,
        advice: remediation,
        attribution,
      });

      // Persist network failure to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.API_FAILURE,
        severity,
        message: `Network Request Failed: ${reason} for ${method} ${url}`,
        stackTrace: failureDetail,
        url: this.deps.getLastKnownUrl() || page.url(),
        endpoint: url,
        method,
        bugClass: attribution.bugClass,
        scenario: attribution.scenario,
        cwe: attribution.cwe,
      });

      // Register network failure bug to memory — one distinct instance per
      // failed request (unique sequenced id), with stack/checklist/suggested fix.
      this.deps.registerConfirmedBug({
        bugId: `network-failed-${Date.now()}-${nextBugSeq()}`,
        type: 'NETWORK',
        message: `Network Request Failed: ${reason}`,
        selector: '',
        payloadUsed: method,
        advice: remediation,
        stackTrace: failureDetail,
        reproductionSteps: reproductionPlaybook,
        reproductionActions: reproduction.actions,
        attribution,
        timestamp: new Date(),
      });
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
    // 🛡️ Initialize stability monitoring - runs silently in background
    // Monitors System Lock-up (5s heartbeat timeout). Real server outages are
    // caught separately via 5xx/requestfailed/pageerror listeners below.
    const cleanup = setupStabilityMonitoring(page, this.deps.telemetry.gateway, onBugRegistered);

    // 🖥️ Setup isolated browser console listener for dedicated Console Tab in dashboard
    // Captures actual browser console.log/warn/info/error without mixing with backend telemetry
    await setupBrowserConsoleListener(page, this.deps.telemetry.gateway);

    return cleanup;
  }
}

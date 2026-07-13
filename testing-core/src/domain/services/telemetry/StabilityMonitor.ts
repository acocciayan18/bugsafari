import type { Dialog, Page, Request, Response } from 'playwright';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { setupStabilityMonitoring } from '../../../infrastructure/monitoring/stabilityMonitor.js';
import { setupBrowserConsoleListener } from '../../../infrastructure/monitoring/browserConsoleListener.js';
import {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../../infrastructure/database/models/ForensicErrorModel.js';
import { classifyFault, matchesCategory, type FaultType } from '../../../bugs/knowledgeBase/index.js';
import { classifyHttpStatus, isExpectedResourceNoise } from '../../scenarios/routeTrasher/routeTrashClassifier.js';
import type { FindingAttribution } from '../../../../../shared/types.js';
import type { StabilityMonitorDeps } from '../exploration/types.js';
import { VerificationPipeline, type VerificationCandidate } from '../verification/index.js';

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

  /** Monitor uncaught JavaScript exceptions and error-level console output. */
  public attachExceptionMonitoring(page: Page): void {
    const t = this.deps.telemetry;

    // Monitor uncaught JavaScript exceptions
    page.on('pageerror', (error: Error) => {
      const message = error?.message ?? 'Unknown page error';
      const stackTrace = error?.stack ?? message;
      const url = page.url();
      const timestamp = new Date().toISOString();
      const breadcrumbs = this.deps.getBreadcrumbs();

      // Freeze the rolling buffer and minimize it to the steps causally required to
      // reach this crash — the active scenario's deliberate steps when one is
      // running, else the fault-anchored slice of the rolling action log.
      const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs: Date.now() });
      const reproductionPlaybook = reproduction.narrative;
      // Verify the fault: classify + provenance-gate + score. A fault whose root
      // cause is not the target app (harness/driver/browser/env) is demoted to
      // informational telemetry and never registered as a bug.
      const verdict = this.verifyFault('EXCEPTION', message, {
        url,
        content: stackTrace,
        evidence: { hasMessage: true, hasStackTrace: Boolean(error?.stack), hasReproductionSteps: reproductionPlaybook.length > 0 },
      });
      const { advice: remediation, severity, attribution } = verdict;
      if (!verdict.report) {
        t.emit('ACTION', {
          actionExecuted: 'unverified-exception',
          message: `ℹ️ Unverified JS exception suppressed (${attribution.origin}): ${verdict.reason}`,
        });
        return;
      }
      this.deps.setFreeze();

      t.emit('EXCEPTION', {
        message: `🔴 Unhandled JS Exception: ${message}`,
        exceptionDetails: { message, stackTrace },
        reproductionSteps: reproductionPlaybook,
        attribution,
      });

      t.gateway.emitIncidentReport({
        timestamp,
        reason: `Unhandled JS Exception: ${message}`,
        url,
        stackTrace,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionPlaybook,
        advice: remediation,
        attribution,
      });

      t.gateway.emitForensicReport({
        timestamp,
        reason: `Unhandled JS Exception: ${message}`,
        url,
        stackTrace,
        breadcrumbs,
        reproductionPlaybook,
        advice: remediation,
        attribution,
      });

      // Persist error to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.JS_EXCEPTION,
        severity,
        message: `🔴 Unhandled JS Exception: ${message}`,
        stackTrace,
        url,
        bugClass: attribution.bugClass,
        scenario: attribution.scenario,
        cwe: attribution.cwe,
      });

      // CRITICAL: register the exception into confirmed-bug memory so the saved
      // history mirrors the live Errors Tab. Previously only HTTP/network faults
      // were registered, so JS exceptions silently vanished from saved history.
      this.deps.registerConfirmedBug({
        bugId: `js-exception-${timestamp}-${nextBugSeq()}`,
        type: 'EXCEPTION',
        message: `Unhandled JS Exception: ${message}`,
        selector: '',
        payloadUsed: '',
        advice: remediation,
        stackTrace,
        reproductionSteps: reproductionPlaybook,
        reproductionActions: reproduction.actions,
        attribution,
        timestamp: new Date(timestamp),
      });
    });

    // Monitor unhandled promise rejections via console errors
    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return;
      }

      const text = message.text();

      // Skip network-related console errors (these are already handled by response monitoring)
      if (text.includes('net::ERR') || text.includes('ERR_')) {
        return;
      }

      const url = page.url();
      const timestamp = new Date().toISOString();
      const breadcrumbs = this.deps.getBreadcrumbs();

      // Freeze the rolling buffer and minimize it to the causal steps (see pageerror).
      const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs: Date.now() });
      const reproductionPlaybook = reproduction.narrative;
      // Verify before reporting (see pageerror): provenance-gate + score.
      const verdict = this.verifyFault('CONSOLE', text, {
        url,
        content: text,
        evidence: { hasMessage: true, hasReproductionSteps: reproductionPlaybook.length > 0 },
      });
      const { advice: remediation, severity, attribution } = verdict;
      if (!verdict.report) {
        t.emit('ACTION', {
          actionExecuted: 'unverified-console-error',
          message: `ℹ️ Unverified console error suppressed (${attribution.origin}): ${verdict.reason}`,
        });
        return;
      }
      this.deps.setFreeze();

      t.emit('EXCEPTION', {
        message: `🔴 Console Error: ${text}`,
        exceptionDetails: { message: text, stackTrace: text },
        reproductionSteps: reproductionPlaybook,
        attribution,
      });

      t.gateway.emitIncidentReport({
        timestamp,
        reason: `Console Error: ${text}`,
        url,
        stackTrace: text,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionPlaybook,
        advice: remediation,
        attribution,
      });

      t.gateway.emitForensicReport({
        timestamp,
        reason: `Console Error: ${text}`,
        url,
        stackTrace: text,
        breadcrumbs,
        reproductionPlaybook,
        advice: remediation,
        attribution,
      });

      // Persist console error to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.CONSOLE_ERROR,
        severity,
        message: `🔴 Console Error: ${text}`,
        stackTrace: text,
        url,
        bugClass: attribution.bugClass,
        scenario: attribution.scenario,
        cwe: attribution.cwe,
      });

      // CRITICAL: register the console error into confirmed-bug memory too, so
      // saved history retains every error the live Errors Tab displayed.
      this.deps.registerConfirmedBug({
        bugId: `console-error-${timestamp}-${nextBugSeq()}`,
        type: 'EXCEPTION',
        message: `Console Error: ${text}`,
        selector: '',
        payloadUsed: '',
        advice: remediation,
        stackTrace: text,
        reproductionSteps: reproductionPlaybook,
        reproductionActions: reproduction.actions,
        attribution,
        timestamp: new Date(timestamp),
      });
    });
  }

  /** Monitor HTTP responses (>=400 or soft-fail body) and outright request failures. */
  public attachNetworkMonitoring(page: Page): void {
    const t = this.deps.telemetry;

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

      // NEW: Filter out false-positive ERR_ABORTED errors from user session cancellation
      // When users cancel a Safari session, unresolved HTTP requests are forcefully cancelled
      // These should be demoted to informational ACTION instead of EXCEPTION to prevent dashboard clutter
      const isAborted = isNetworkAbortedError(reason);

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

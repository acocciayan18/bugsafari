import type { Dialog, Page, Request, Response } from 'playwright';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { setupStabilityMonitoring } from '../../../infrastructure/monitoring/stabilityMonitor.js';
import { setupBrowserConsoleListener } from '../../../infrastructure/monitoring/browserConsoleListener.js';
import {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../../infrastructure/database/models/ForensicErrorModel.js';
import type { StabilityMonitorDeps } from '../exploration/types.js';

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

/**
 * Generate a clean, copyable remediation snippet (the diagnostic-layer
 * `suggestedFix` placeholder) for a confirmed finding.
 */
export function buildRemediation(type: string, reason: string): string {
  if (type === 'NETWORK') {
    return [
      `// Suggested remediation — network/server fault`,
      `// 1. Verify endpoint health and response for: ${reason}`,
      `// 2. Add retry with backoff plus a user-facing error state`,
      `// 3. Guard the call site against null / timeout responses`,
    ].join('\n');
  }
  return [
    `// Suggested remediation — runtime exception`,
    `// 1. Reproduce via the replication checklist above`,
    `// 2. Wrap the failing operation in try/catch; add a null guard before: ${reason}`,
    `// 3. Add a regression test asserting the element/handler stays stable`,
  ].join('\n');
}

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
  constructor(private readonly deps: StabilityMonitorDeps) {}

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

      // Freeze the rolling buffer and flush the active scenario's deliberate steps
      // (falling back to the rolling action log) at the exact moment of the crash.
      const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();
      // One remediation string, bound identically to the live reports and the
      // saved confirmed bug so the dashboard's Suggested Fix matches history.
      const remediation = buildRemediation('EXCEPTION', message);
      this.deps.setFreeze();

      t.emit('EXCEPTION', {
        message: `🔴 Unhandled JS Exception: ${message}`,
        exceptionDetails: { message, stackTrace },
        reproductionSteps: reproductionPlaybook,
      });

      t.gateway.emitIncidentReport({
        timestamp,
        reason: `Unhandled JS Exception: ${message}`,
        url,
        stackTrace,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionPlaybook,
        advice: remediation,
      });

      t.gateway.emitForensicReport({
        timestamp,
        reason: `Unhandled JS Exception: ${message}`,
        url,
        stackTrace,
        breadcrumbs,
        reproductionPlaybook,
        advice: remediation,
      });

      // Persist error to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.JS_EXCEPTION,
        severity: ForensicErrorSeverity.HIGH,
        message: `🔴 Unhandled JS Exception: ${message}`,
        stackTrace,
        url,
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

      // Freeze the rolling buffer and flush the active scenario's deliberate steps
      // (falling back to the rolling action log) at the exact moment of the crash.
      const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();
      // One remediation string, bound identically to the live reports and the
      // saved confirmed bug (see the pageerror handler).
      const remediation = buildRemediation('EXCEPTION', text);
      this.deps.setFreeze();

      t.emit('EXCEPTION', {
        message: `🔴 Console Error: ${text}`,
        exceptionDetails: { message: text, stackTrace: text },
        reproductionSteps: reproductionPlaybook,
      });

      t.gateway.emitIncidentReport({
        timestamp,
        reason: `Console Error: ${text}`,
        url,
        stackTrace: text,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionPlaybook,
        advice: remediation,
      });

      t.gateway.emitForensicReport({
        timestamp,
        reason: `Console Error: ${text}`,
        url,
        stackTrace: text,
        breadcrumbs,
        reproductionPlaybook,
        advice: remediation,
      });

      // Persist console error to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.CONSOLE_ERROR,
        severity: ForensicErrorSeverity.MEDIUM,
        message: `🔴 Console Error: ${text}`,
        stackTrace: text,
        url,
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
        timestamp: new Date(timestamp),
      });
    });
  }

  /** Monitor HTTP responses (>=400 or soft-fail body) and outright request failures. */
  public attachNetworkMonitoring(page: Page): void {
    const t = this.deps.telemetry;

    // Task 1 Fix: Add response handler for NETWORK telemetry
    page.on('response', async (response: Response) => {
      const status = response.status();
      const url = response.url();
      const method = response.request().method();
      const resourceType = response.request().resourceType();

      // Skip frontend assets to prevent false positives
      if (url.includes('vite') ||
        url.includes('node_modules') ||
        url.endsWith('.js') ||
        url.endsWith('.css') ||
        resourceType === 'script' ||
        resourceType === 'stylesheet') {
        return;
      }

      // Emit NETWORK for failures (>=400 per TESTING_TYPES.md) or soft-fail body
      let shouldEmit = status >= 400;
      let bodyContent = '';

      if (!shouldEmit) {
        try {
          bodyContent = await response.text().catch(() => '');
          const bodyLower = bodyContent.toLowerCase();
          const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
          const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));
          shouldEmit = hasErrorFlag || hasStatusFail;
        } catch {
          // Ignore body parse errors
        }
      }

      if (shouldEmit) {
        // Phase 3: Track failed requests count
        this.deps.onApiFailure();

        // One immutable snapshot, frozen at the moment this response failed, bound
        // identically to the live telemetry and the saved confirmed bug. Reading
        // the global rolling buffer twice (once per consumer) risks the live card
        // and the stored record diverging if an action lands between the reads.
        const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();
        const remediation = buildRemediation('NETWORK', `HTTP ${status} ${method} ${url}`);

        t.emit('NETWORK', {
          statusCode: status,
          url,
          method,
          message: `Network ${status} ${method} ${url}`,
          reproductionSteps: reproductionPlaybook,
        });

        // Persist API failure to forensic_errors database (Phase 2: Error Logging System)
        this.deps.persistForensicError({
          type: ForensicErrorType.API_FAILURE,
          severity: status >= 500 ? ForensicErrorSeverity.HIGH : ForensicErrorSeverity.MEDIUM,
          message: `API Failure: HTTP ${status} ${method} ${url}`,
          stackTrace: `HTTP ${status} response from ${url}${bodyContent ? ` - Body: ${bodyContent.slice(0, 500)}` : ''}`,
          url: this.deps.getLastKnownUrl() || page.url(),
          endpoint: url,
          method,
          statusCode: status,
          responseText: bodyContent.slice(0, 500),
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
          timestamp: new Date(),
        });
      }
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
        // Demote to informational ACTION - user session was cancelled, not a real error
        t.emit('ACTION', {
          actionExecuted: 'network-aborted',
          url,
          method,
          message: `ℹ️ Active network connection closed due to user session abort. ${method} ${url}`,
        });
        // Skip persistent logging for aborts - these are expected cancellation events
        return;
      }

      // Process as EXCEPTION for real network failures
      const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();
      // One remediation string, bound identically to the live reports and the
      // saved confirmed bug (see the pageerror handler).
      const remediation = buildRemediation('NETWORK', `${method} ${url} - ${reason}`);

      t.emit('EXCEPTION', {
        url,
        method,
        message: `Network Request Failed: ${reason} for ${method} ${url}`,
        reproductionSteps: reproductionPlaybook,
      });

      t.gateway.emitIncidentReport({
        timestamp,
        reason: `Network Request Failed: ${reason}`,
        url: this.deps.getLastKnownUrl() || page.url(),
        stackTrace: `${method} ${url} - ${reason}`,
        steps: this.deps.breadcrumbsToActionRecords(breadcrumbs),
        reproductionPlaybook,
        advice: remediation,
      });

      t.gateway.emitForensicReport({
        timestamp,
        reason: `Network Request Failed: ${reason}`,
        url: this.deps.getLastKnownUrl() || page.url(),
        stackTrace: `${method} ${url} - ${reason}`,
        breadcrumbs,
        reproductionPlaybook,
        advice: remediation,
      });

      // Persist network failure to forensic_errors database (Phase 2: Error Logging System)
      this.deps.persistForensicError({
        type: ForensicErrorType.API_FAILURE,
        severity: ForensicErrorSeverity.HIGH,
        message: `Network Request Failed: ${reason} for ${method} ${url}`,
        stackTrace: `${method} ${url} - ${reason}`,
        url: this.deps.getLastKnownUrl() || page.url(),
        endpoint: url,
        method,
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
        stackTrace: `${method} ${url} - ${reason}`,
        reproductionSteps: reproductionPlaybook,
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
    // Monitors JS Exceptions, 500 Errors, and System Lock-up (5s heartbeat timeout)
    const cleanup = setupStabilityMonitoring(page, this.deps.telemetry.gateway, onBugRegistered);

    // 🖥️ Setup isolated browser console listener for dedicated Console Tab in dashboard
    // Captures actual browser console.log/warn/info/error without mixing with backend telemetry
    await setupBrowserConsoleListener(page, this.deps.telemetry.gateway);

    return cleanup;
  }
}

import type { Page, Request, Response } from 'playwright';
import type { ForensicCrashReport, IncidentReport, TelemetryMeta, TelemetryType } from '../../../../shared/types.ts';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { ActionRecorder } from './actionBuffer.js';
import { TelemetryHub } from './socketServer.js';

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

const DEEP_SCAN_PATTERNS: RegExp[] = [
  /internal server error/i,
  /database error/i,
  /sql execution failed/i,
];

interface BrowserExceptionPayload {
  message: string;
  stackTrace: string;
}

/**
 * Signal object to halt execution when critical issues are detected.
 */
export class CrashSignal {
  private halted = false;
  private reason = '';

  halt(reason: string): void {
    this.halted = true;
    this.reason = reason;
  }

  isHalted(): boolean {
    return this.halted;
  }

  getReason(): string {
    return this.reason;
  }
}

type Cleanup = () => void;

interface RuntimeMonitorOptions {
  hub?: TelemetryHub;
  actionRecorder?: ActionRecorder;
}

/**
 * Unified runtime monitor that combines:
 * - Heartbeat/main thread lockup detection
 * - JS exception handling (pageerror)
 * - Server error monitoring (500+)
 * - Console error handling
 * - Request failure monitoring
 * - Client-side exception reporting
 * - CrashSignal halt mechanism
 * - Deep scan patterns for error detection
 * - Reproduction steps support via ActionRecorder
 *
 * Works with either TelemetryGateway (AutonomousExplorationEngine)
 * or TelemetryHub + ActionRecorder (autonomousLoop)
 */
export function setupRuntimeMonitor(
  page: Page,
  telemetry: TelemetryGateway,
  options: RuntimeMonitorOptions = {},
): Cleanup {
  const { hub, actionRecorder } = options;

  let disposed = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatInFlight = false;
  let lastHeartbeatAlertAt = 0;

// Helper to emit telemetry - works with both TelemetryGateway and TelemetryHub
  const emitTelemetry = (event: { timestamp: string; type: TelemetryType; meta: TelemetryMeta }): void => {
    if (hub) {
      hub.emitTelemetry(event as { timestamp: string; type: TelemetryType; meta: TelemetryMeta });
    } else if (telemetry) {
      telemetry.emitTelemetry(event as never);
    }
  };

  const emitForensicReport = (report: ForensicCrashReport): void => {
    if (hub) {
      hub.emitForensicReport(report);
    } else if (telemetry) {
      telemetry.emitForensicReport(report);
    }
  };

  const emitIncidentReport = (report: IncidentReport): void => {
    if (hub) {
      hub.emitIncidentReport(report);
    } else if (telemetry) {
      telemetry.emitIncidentReport(report);
    }
  };

  const emitUnhandledJsException = (errorMessage: string, stackTrace: string): void => {
    const reproSteps = actionRecorder?.toReproductionSteps() ?? [];
    const breadcrumbs = actionRecorder?.snapshot() ?? [];

    emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message: `❌ Unhandled JS Exception: ${errorMessage}. The user's screen is likely frozen or non-functional.`,
        exceptionDetails: {
          message: errorMessage,
          stackTrace,
        },
        reproductionSteps: reproSteps,
      },
    });

    const forensicReport: ForensicCrashReport = {
      timestamp: new Date().toISOString(),
      reason: `JS Exception: ${errorMessage}`,
      url: page.url(),
      stackTrace,
      breadcrumbs: breadcrumbs.map((s) => ({
        timestamp: s.timestamp,
        selector: s.selector,
        action: s.type,
        payload: s.payload,
        score: undefined,
      })),
    };
    emitForensicReport(forensicReport);
  };

  const emitServerCollapse = (statusCode: number, url: string, method?: string, evidence?: string): void => {
    const detailSuffix = evidence ? ` Evidence: ${evidence}` : '';
    const reproSteps = actionRecorder?.toReproductionSteps() ?? [];
    const breadcrumbs = actionRecorder?.snapshot() ?? [];

    emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'NETWORK',
      meta: {
        url,
        method: method ?? 'UNKNOWN',
        statusCode,
        message: `🔥 Server Collapse: Backend returned a ${statusCode} error. The application's data layer is failing.${detailSuffix}`,
        reproductionSteps: reproSteps,
      },
    });

    const incidentReport: IncidentReport = {
      timestamp: new Date().toISOString(),
      reason: `HTTP ${statusCode} from ${url}`,
      url,
      statusCode,
      stackTrace: evidence ?? `HTTP ${statusCode}`,
      steps: breadcrumbs,
    };
    emitIncidentReport(incidentReport);
  };

  const emitMainThreadLockup = (): void => {
    const reproSteps = actionRecorder?.toReproductionSteps() ?? [];

    emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message:
          "🧊 System Lock-up Detected: The browser's Main Thread is unresponsive. Interaction is impossible.",
        exceptionDetails: {
          message: 'Main Thread heartbeat timeout',
          stackTrace: 'Heartbeat evaluate call exceeded 5000ms timeout.',
        },
        reproductionSteps: reproSteps,
      },
    });
  };

  const onPageError = (error: Error): void => {
    const errorMessage = error?.message ?? 'Unknown page error';
    const stackTrace = error?.stack ?? errorMessage;
    emitUnhandledJsException(errorMessage, stackTrace);
  };

  const onConsoleError = (text: string): void => {
    // Skip network-related console errors
    if (text.includes('net::ERR') || text.includes('ERR_')) {
      return;
    }

    const reproSteps = actionRecorder?.toReproductionSteps() ?? [];
    const breadcrumbs = actionRecorder?.snapshot() ?? [];

    emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message: `Console Error: ${text}`,
        exceptionDetails: {
          message: text,
          stackTrace: text,
        },
        reproductionSteps: reproSteps,
      },
    });

    const incidentReport: IncidentReport = {
      timestamp: new Date().toISOString(),
      reason: text,
      url: page.url(),
      stackTrace: text,
      steps: breadcrumbs,
    };
    emitIncidentReport(incidentReport);
  };

  const onResponse = async (response: Response): Promise<void> => {
    if (disposed) {
      return;
    }

    const statusCode = response.status();
    const url = response.url();
    const method = response.request().method();

    if (statusCode >= 500) {
      emitServerCollapse(statusCode, url, method);
      return;
    }

    try {
      const body = await response.text();
      if (DEEP_SCAN_PATTERNS.some((pattern) => pattern.test(body))) {
        emitServerCollapse(statusCode, url, method, body.slice(0, 500));
      }
    } catch {
      // Ignore unreadable/streamed/binary responses.
    }
  };

  const onRequestFailed = (request: Request): void => {
    const failureText = request.failure()?.errorText ?? 'Request failed';

    emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'NETWORK',
      meta: {
        url: request.url(),
        method: request.method(),
        message: failureText,
      },
    });
  };

  const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  };

  const runHeartbeat = async (): Promise<void> => {
    if (disposed || heartbeatInFlight || page.isClosed()) {
      return;
    }

    heartbeatInFlight = true;
    try {
      await withTimeout(page.evaluate(() => true), HEARTBEAT_TIMEOUT_MS);
    } catch {
      const now = Date.now();
      if (now - lastHeartbeatAlertAt >= HEARTBEAT_TIMEOUT_MS) {
        emitMainThreadLockup();
        lastHeartbeatAlertAt = now;
      }
    } finally {
      heartbeatInFlight = false;
    }
  };

  // Expose client-side exception reporter
  const setupClientExceptionReporting = async (): Promise<void> => {
    if (!hub) return;

    await page.exposeFunction('__bugSafariReportException', (payload: BrowserExceptionPayload) => {
      emitUnhandledJsException(payload.message, payload.stackTrace);
    });

    await page.addInitScript({
      content: `
        (() => {
          const report = (message, stackTrace) => {
            if (typeof window.__bugSafariReportException === 'function') {
              window.__bugSafariReportException({ message, stackTrace });
            }
          };

          window.addEventListener('error', (event) => {
            const stackTrace = event.error instanceof Error && event.error.stack ? event.error.stack : event.message;
            report(event.message, stackTrace);
          });

          window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            const message = reason instanceof Error ? reason.message : String(reason);
            const stackTrace = reason instanceof Error && reason.stack ? reason.stack : message;
            report(message, stackTrace);
          });
        })();
      `,
    });
  };

  // Set up event listeners
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  if (hub) {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        onConsoleError(message.text());
      }
    });
  }

  // Set up heartbeat monitoring
  heartbeatInterval = setInterval(() => {
    void runHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  // Prime first heartbeat immediately so detection starts without waiting initial interval.
  void runHeartbeat();

  // Set up client-side exception reporting if hub is available
  void setupClientExceptionReporting();

  return (): void => {
    disposed = true;

    page.off('pageerror', onPageError);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };
}

/**
 * Legacy helper function for backward compatibility with exceptionCatcher pattern.
 * Returns CrashSignal and sets up monitoring with TelemetryHub + ActionRecorder.
 *
 * @deprecated Use setupRuntimeMonitor() instead for new code.
 */
export async function setupExceptionCatcher(
  page: Page,
  hub: TelemetryHub,
  actionRecorder: ActionRecorder,
): Promise<CrashSignal> {
  // Create a compatibility layer - emitTelemetry using hub
  const emitCompat = (event: { timestamp: string; type: string; meta: unknown }): void => {
    hub.emitTelemetry(event as never);
  };

  const crashSignal = new CrashSignal();
  const requestStartedAt = new Map<Request, number>();

  const emitException = (message: string, stackTrace: string, shouldHalt: boolean, statusCode?: number): void => {
    const url = page.url();

    const incidentReport: IncidentReport = {
      timestamp: new Date().toISOString(),
      reason: message,
      url,
      statusCode,
      stackTrace,
      steps: actionRecorder.snapshot(),
    };

    const forensicReport: ForensicCrashReport = {
      timestamp: new Date().toISOString(),
      reason: message,
      url,
      statusCode,
      stackTrace,
      breadcrumbs: actionRecorder.snapshot().map((s) => ({
        timestamp: s.timestamp,
        selector: s.selector,
        action: s.type,
        payload: s.payload,
        score: undefined,
      })),
    };

    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message,
        exceptionDetails: {
          message,
          stackTrace,
        },
        reproductionSteps: actionRecorder.toReproductionSteps(),
      },
    });

    hub.emitIncidentReport(incidentReport);
    hub.emitForensicReport(forensicReport);

    if (shouldHalt) {
      crashSignal.halt(message);
    }
  };

  await page.exposeFunction('__bugSafariReportException', (payload: BrowserExceptionPayload) => {
    emitException(payload.message, payload.stackTrace, true);
  });

  await page.addInitScript({
    content: `
      (() => {
        const report = (message, stackTrace) => {
          if (typeof window.__bugSafariReportException === 'function') {
            window.__bugSafariReportException({ message, stackTrace });
          }
        };

        window.addEventListener('error', (event) => {
          const stackTrace = event.error instanceof Error && event.error.stack ? event.error.stack : event.message;
          report(event.message, stackTrace);
        });

        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason;
          const message = reason instanceof Error ? reason.message : String(reason);
          const stackTrace = reason instanceof Error && reason.stack ? reason.stack : message;
          report(message, stackTrace);
        });
      })();
    `,
  });

  page.on('pageerror', (error) => {
    emitException(error.message, error.stack ?? error.message, true);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();

    if (text.includes('net::ERR')) {
      return;
    }

    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message: text,
        exceptionDetails: {
          message: text,
          stackTrace: text,
        },
        reproductionSteps: actionRecorder.toReproductionSteps(),
      },
    });
    hub.emitIncidentReport({
      timestamp: new Date().toISOString(),
      reason: text,
      url: page.url(),
      stackTrace: text,
      steps: actionRecorder.snapshot(),
    });
    crashSignal.halt(text);
  });

  page.on('request', (request) => {
    requestStartedAt.set(request, Date.now());
  });

  page.on('response', (response) => {
    const request = response.request();
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    requestStartedAt.delete(request);

    const durationMs = Date.now() - startedAt;
    const statusCode = response.status();
    const url = response.url();
    const method = request.method();

    // Only emit NETWORK telemetry for failures (>= 500).
    if (statusCode >= 500) {
      hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'NETWORK',
        meta: {
          url,
          method,
          statusCode,
          durationMs,
          message: `${method} ${statusCode} ${url}`,
        },
      });
      emitException(`Server failure ${statusCode} from ${url}`, `HTTP ${statusCode} ${method} ${url}`, true, statusCode);
    }
  });

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText ?? 'Request failed';

    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'NETWORK',
      meta: {
        url: request.url(),
        method: request.method(),
        message: failureText,
      },
    });
  });

  return crashSignal;
}

/**
 * Setup function for backward compatibility with stabilityMonitor pattern.
 * Uses TelemetryGateway only (no hub/actionRecorder).
 *
 * @deprecated Use setupRuntimeMonitor() instead for new code.
 */
export function setupStabilityMonitoring(page: Page, telemetry: TelemetryGateway): Cleanup {
  return setupRuntimeMonitor(page, telemetry);
}

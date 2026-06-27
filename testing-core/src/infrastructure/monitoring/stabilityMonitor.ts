import type { Page, Response } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { ActiveScenarioTracker } from './activeScenarioTracker.js';

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

const DEEP_SCAN_PATTERNS: RegExp[] = [
  /internal server error/i,
  /database error/i,
  /sql execution failed/i,
];

type Cleanup = () => void;

/** Bug registration callback for confirmed bugs */
export type BugRegistrationCallback = (bug: {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
}) => void;

/**
 * Monitors catastrophic runtime instability signals during an active Safari session.
 * Runs silently in the background and can be safely disposed.
 * @param page - Playwright page to monitor
 * @param telemetry - Telemetry gateway for emitting events
 * @param onBugRegistered - Optional callback to register confirmed bugs to memory (NEW)
 */
export function setupStabilityMonitoring(
  page: Page,
  telemetry: TelemetryGateway,
  onBugRegistered?: BugRegistrationCallback
): Cleanup {
  let disposed = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatInFlight = false;
  let lastHeartbeatAlertAt = 0;

  const emitUnhandledJsException = (errorMessage: string, stackTrace: string): void => {
    const timestamp = new Date().toISOString();
    const url = page.url();
    const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();

    telemetry.emitTelemetry({
      timestamp,
      type: 'EXCEPTION',
      meta: {
        message: `❌ Unhandled JS Exception: ${errorMessage}. The user's screen is likely frozen or non-functional.`,
        exceptionDetails: {
          message: errorMessage,
          stackTrace,
        },
        reproductionSteps: reproductionPlaybook,
      },
    });

    // Emit as incident report for error tab display
    telemetry.emitIncidentReport({
      timestamp,
      reason: errorMessage,
      url,
      stackTrace,
      steps: [],
      reproductionPlaybook,
    });

    // Emit as forensic report
    telemetry.emitForensicReport({
      timestamp,
      reason: `JS Exception: ${errorMessage}`,
      url,
      stackTrace,
      breadcrumbs: [],
      reproductionPlaybook,
    });

    // NEW: Register bug to memory if callback provided
    if (onBugRegistered) {
      onBugRegistered({
        bugId: `js-exception-${Date.now()}`,
        type: 'RUNTIME_UI_FREEZE',
        message: `Unhandled JS Exception: ${errorMessage}`,
        selector: '',
        payloadUsed: '',
        advice: 'Check browser console for details. Fix the JavaScript error.',
        timestamp: new Date(),
      });
    }
  };

  const emitServerCollapse = (statusCode: number, url: string, method?: string, evidence?: string): void => {
    const timestamp = new Date().toISOString();
    const detailSuffix = evidence ? ` Evidence: ${evidence}` : '';
    const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();

    telemetry.emitTelemetry({
      timestamp,
      type: 'NETWORK',
      meta: {
        url,
        method: method ?? 'UNKNOWN',
        statusCode,
        message: `🔥 Server Collapse: Backend returned a ${statusCode} error. The application's data layer is failing.${detailSuffix}`,
        reproductionSteps: reproductionPlaybook,
      },
    });

    // Emit as incident report for error tab display
    telemetry.emitIncidentReport({
      timestamp,
      reason: `HTTP ${statusCode} from ${url}`,
      url,
      statusCode,
      stackTrace: evidence ?? `HTTP ${statusCode}`,
      steps: [],
      reproductionPlaybook,
    });

    // Emit as forensic report
    telemetry.emitForensicReport({
      timestamp,
      reason: `HTTP ${statusCode}: Backend returned a ${statusCode} error.${detailSuffix}`,
      url,
      statusCode,
      stackTrace: evidence ?? `HTTP ${statusCode}`,
      breadcrumbs: [],
      reproductionPlaybook,
    });

    // NEW: Register bug to memory if callback provided
    if (onBugRegistered) {
      onBugRegistered({
        bugId: `server-collapse-${Date.now()}`,
        type: 'NETWORK',
        message: `Server Collapse: HTTP ${statusCode} from ${url}`,
        selector: '',
        payloadUsed: method ?? 'GET',
        advice: `Check backend server. HTTP ${statusCode} indicates server failure.`,
        timestamp: new Date(),
      });
    }
  };

  const emitMainThreadLockup = (): void => {
    const timestamp = new Date().toISOString();
    const url = page.url();
    const stackTrace = 'Heartbeat evaluate call exceeded 5000ms timeout.';
    const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();

    telemetry.emitTelemetry({
      timestamp,
      type: 'EXCEPTION',
      meta: {
        message:
          "🧊 System Lock-up Detected: The browser's Main Thread is unresponsive. Interaction is impossible.",
        exceptionDetails: {
          message: 'Main Thread heartbeat timeout',
          stackTrace,
        },
        reproductionSteps: reproductionPlaybook,
      },
    });

    // Emit as incident report for error tab display
    telemetry.emitIncidentReport({
      timestamp,
      reason: 'Main Thread Lock-up Detected',
      url,
      stackTrace,
      steps: [],
      reproductionPlaybook,
    });

    // Emit as forensic report
    telemetry.emitForensicReport({
      timestamp,
      reason: "System Lock-up Detected: The browser's Main Thread is unresponsive.",
      url,
      stackTrace,
      breadcrumbs: [],
      reproductionPlaybook,
    });

    // NEW: Register bug to memory if callback provided
    if (onBugRegistered) {
      onBugRegistered({
        bugId: `main-thread-lockup-${Date.now()}`,
        type: 'RUNTIME_UI_FREEZE',
        message: '🧊 System Lock-up Detected: Main Thread unresponsive',
        selector: '',
        payloadUsed: '',
        advice: 'Check for infinite loops or heavy JavaScript operations blocking the main thread.',
        timestamp: new Date(),
      });
    }
  };

  const onPageError = (error: Error): void => {
    const errorMessage = error?.message ?? 'Unknown page error';
    const stackTrace = error?.stack ?? errorMessage;
    emitUnhandledJsException(errorMessage, stackTrace);
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

  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  heartbeatInterval = setInterval(() => {
    void runHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  // Prime first heartbeat immediately so detection starts without waiting initial interval.
  void runHeartbeat();

  return (): void => {
    disposed = true;

    page.off('pageerror', onPageError);
    page.off('response', onResponse);

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };
}

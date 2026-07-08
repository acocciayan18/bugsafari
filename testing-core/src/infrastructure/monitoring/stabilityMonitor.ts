import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { FindingAttribution } from '../../../../shared/types.js';
import { classifyFault, type FaultType } from '../../bugs/knowledgeBase/index.js';
import { ActiveScenarioTracker } from './activeScenarioTracker.js';

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

type Cleanup = () => void;

/**
 * Classify a background-monitor fault against the knowledge base and attribute it
 * to the scenario/step active at fault time — keeping this secondary detector's
 * findings consistent with the primary StabilityMonitor.
 */
function classify(
  faultType: FaultType,
  message: string,
  opts?: { statusCode?: number; url?: string; content?: string },
): { advice: string; attribution: FindingAttribution } {
  const c = classifyFault({
    faultType,
    message,
    statusCode: opts?.statusCode,
    url: opts?.url,
    content: opts?.content,
    scenario: ActiveScenarioTracker.getActiveScenarioName(),
    stepIndex: ActiveScenarioTracker.getCurrentStepIndex(),
  });
  return {
    advice: c.advice,
    attribution: {
      bugClass: c.bugClass,
      cwe: c.cwe,
      scenario: c.scenario,
      testingType: c.testingType,
      stepIndex: c.stepIndex,
    },
  };
}

/** Bug registration callback for confirmed bugs */
export type BugRegistrationCallback = (bug: {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
  attribution?: FindingAttribution;
}) => void;

/**
 * Background main-thread lock-up detector for an active Safari session.
 *
 * Scope is deliberately narrow: a periodic heartbeat that flags an unresponsive
 * main thread (a freeze no page/response event can reveal). Uncaught page errors
 * and HTTP 5xx/soft-fail responses are owned SOLELY by the primary
 * `domain/services/telemetry/StabilityMonitor` (which persists to the forensic
 * DB) — this monitor no longer listens for them, so a single fault produces a
 * single finding. Runs silently and can be safely disposed.
 *
 * @param page - Playwright page to monitor
 * @param telemetry - Telemetry gateway for emitting events
 * @param onBugRegistered - Optional callback to register confirmed bugs to memory
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

  const emitMainThreadLockup = (): void => {
    const timestamp = new Date().toISOString();
    const url = page.url();
    const stackTrace = 'Heartbeat evaluate call exceeded 5000ms timeout.';
    const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();
    const { advice, attribution } = classify('FREEZE', 'System Lock-up Detected: Main Thread unresponsive', { url });

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
        attribution,
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
      advice,
      attribution,
    });

    // Emit as forensic report
    telemetry.emitForensicReport({
      timestamp,
      reason: "System Lock-up Detected: The browser's Main Thread is unresponsive.",
      url,
      stackTrace,
      breadcrumbs: [],
      reproductionPlaybook,
      advice,
      attribution,
    });

    // NEW: Register bug to memory if callback provided
    if (onBugRegistered) {
      onBugRegistered({
        bugId: `main-thread-lockup-${Date.now()}`,
        type: 'RUNTIME_UI_FREEZE',
        message: '🧊 System Lock-up Detected: Main Thread unresponsive',
        selector: '',
        payloadUsed: '',
        advice,
        timestamp: new Date(),
        attribution,
      });
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

  heartbeatInterval = setInterval(() => {
    void runHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  // Prime first heartbeat immediately so detection starts without waiting initial interval.
  void runHeartbeat();

  return (): void => {
    disposed = true;

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };
}

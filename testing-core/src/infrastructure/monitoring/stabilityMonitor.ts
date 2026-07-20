import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { ActionRecord, FindingAttribution, StateFingerprint } from '../../../../shared/types.js';
import { classifyFault, type FaultType } from '../../bugs/knowledgeBase/index.js';
import { ActiveScenarioTracker } from './activeScenarioTracker.js';
import { captureStateFingerprint } from './stateFingerprint.js';

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
// After a heartbeat timeout, let the browser thread settle then re-probe
// its responsiveness a bounded number of times before declaring a real UI freeze.
const RECOVERY_SETTLE_MS = 500;
const STABILITY_RETRIES = 3;

type Cleanup = () => void;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  reproductionSteps?: string[];
  reproductionActions?: ActionRecord[];
  stateFingerprint?: StateFingerprint;
  attribution?: FindingAttribution;
  streamed?: boolean;
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

  // Emit a confirmed UI-freeze finding. Genuine server faults (5xx / requestfailed
  // / pageerror) are owned solely by the primary domain StabilityMonitor, so this
  // detector only ever reports a sustained local browser lock-up.
  const emitFreezeFinding = async (faultAtMs: number): Promise<void> => {
    const timestamp = new Date().toISOString();
    const url = page.url();
    const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs });
    const reproductionPlaybook = reproduction.narrative;
    // Renderer is unresponsive during a freeze — capture cookies only (no storage evaluate).
    const stateFingerprint = await captureStateFingerprint(page, { cookiesOnly: true });

    const faultType: FaultType = 'FREEZE';
    const reason = "System Lock-up Detected: The browser's Main Thread is unresponsive.";
    const banner = "🧊 System Lock-up Detected: The browser's Main Thread is unresponsive. Interaction is impossible.";
    const stackTrace = 'Heartbeat evaluate call exceeded 5000ms timeout.';
    const { advice, attribution } = classify(faultType, reason, { url });

    telemetry.emitTelemetry({
      timestamp,
      type: 'EXCEPTION',
      meta: {
        message: banner,
        exceptionDetails: { message: reason, stackTrace },
        reproductionSteps: reproductionPlaybook,
        attribution,
      },
    });
    telemetry.emitIncidentReport({
      timestamp,
      // Same canonical reason as the forensic emission below so the incident +
      // forensic + synthesized-incident collapse to one Errors-tab card.
      reason,
      url,
      stackTrace,
      steps: [],
      reproductionActions: reproduction.actions,
      stateFingerprint,
      reproductionPlaybook,
      advice,
      attribution,
    });
    telemetry.emitForensicReport({
      timestamp,
      reason,
      url,
      stackTrace,
      breadcrumbs: [],
      reproductionPlaybook,
      advice,
      attribution,
    });

    if (onBugRegistered) {
      onBugRegistered({
        bugId: `main-thread-lockup-${Date.now()}`,
        type: 'RUNTIME_UI_FREEZE',
        // Same canonical text as the live incident/forensic reason so the saved
        // finding message matches the Errors-tab card (banner stays terminal-only).
        message: reason,
        selector: '',
        payloadUsed: '',
        advice,
        timestamp: new Date(),
        reproductionSteps: reproductionPlaybook,
        reproductionActions: reproduction.actions,
        stateFingerprint,
        attribution,
        streamed: true, // already emitted to the Errors tab above — don't double-stream
      });
    }
  };

  // Informational-only: a browser freeze was seen and recovery is being attempted.
  // No finding, no forensic record — just operator signal.
  const emitInfo = (message: string): void => {
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: { actionExecuted: 'browser-freeze-recovery', url: page.url(), message },
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

  // Probe the main thread once; true if it answered within the timeout.
  const threadResponsive = async (): Promise<boolean> => {
    if (disposed || page.isClosed()) return false;
    try {
      await withTimeout(page.evaluate(() => true), HEARTBEAT_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  };

  // Give the browser a brief window to recover, re-validating page stability a
  // bounded number of times. Returns true once the main thread is responsive again.
  const validatePageStability = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < STABILITY_RETRIES; attempt += 1) {
      if (disposed || page.isClosed()) return false;
      await sleep(RECOVERY_SETTLE_MS);
      if (await threadResponsive()) return true;
    }
    return false;
  };

  // Heartbeat timeout handler. A blocked browser thread is a local freeze — give
  // it a brief window to recover before declaring a sustained UI lock-up. Real
  // server outages are caught by the primary StabilityMonitor's 5xx/requestfailed
  // /pageerror listeners, not this heartbeat.
  const handleHeartbeatTimeout = async (faultAtMs: number): Promise<void> => {
    emitInfo(' Browser thread stalled — attempting local recovery...');
    const recovered = await validatePageStability();
    if (disposed) return;

    if (recovered) {
      emitInfo('Browser thread recovered — resuming exploration.');
    } else {
      await emitFreezeFinding(faultAtMs);
    }
  };

  const runHeartbeat = async (): Promise<void> => {
    if (disposed || heartbeatInFlight || page.isClosed()) {
      return;
    }

    heartbeatInFlight = true;
    try {
      // The freeze onset is when this probe was sent, not when we later escalate —
      // anchoring the fault here trims the ~5s stall + recovery window from repro steps.
      const probeStartedAt = Date.now();
      if (await threadResponsive()) return;
      // Rate-limit escalation so one sustained freeze doesn't spam the pipeline.
      const now = Date.now();
      if (now - lastHeartbeatAlertAt < HEARTBEAT_TIMEOUT_MS) return;
      lastHeartbeatAlertAt = now;
      await handleHeartbeatTimeout(probeStartedAt);
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

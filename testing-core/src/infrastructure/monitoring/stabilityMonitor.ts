import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { FindingAttribution } from '../../../../shared/types.js';
import { classifyFault, type FaultType } from '../../bugs/knowledgeBase/index.js';
import { ActiveScenarioTracker } from './activeScenarioTracker.js';
import { isServerReachable } from './serverReachability.js';

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
// Isolated server probe budget when a heartbeat times out — independent of the
// (possibly frozen) browser thread, so it can't be starved by the lockup.
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
// After confirming the server is up, let the browser thread settle then re-probe
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
 * @param targetUrl - Target URL probed by the ISOLATED Node health client on a
 *   heartbeat timeout, to tell a local browser freeze apart from a server outage
 * @param onBugRegistered - Optional callback to register confirmed bugs to memory
 */
export function setupStabilityMonitoring(
  page: Page,
  telemetry: TelemetryGateway,
  targetUrl: string,
  onBugRegistered?: BugRegistrationCallback
): Cleanup {
  let disposed = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatInFlight = false;
  let lastHeartbeatAlertAt = 0;

  // Emit a confirmed freeze/crash finding. `kind` decides the classification: a
  // sustained local browser freeze (server proven up) vs a genuine server crash
  // (isolated probe proven down) — the two are never conflated.
  const emitFreezeFinding = (kind: 'ui-freeze' | 'server-crash'): void => {
    const timestamp = new Date().toISOString();
    const url = page.url();
    const reproductionPlaybook = ActiveScenarioTracker.flushPlaybook();

    const isCrash = kind === 'server-crash';
    const faultType: FaultType = isCrash ? 'NETWORK' : 'FREEZE';
    const reason = isCrash
      ? `Critical Server Crash: target ${targetUrl} unreachable while the browser thread was blocked.`
      : "System Lock-up Detected: The browser's Main Thread is unresponsive.";
    const banner = isCrash
      ? `🔴 Critical Server Crash: ${targetUrl} is unreachable (confirmed by isolated health check).`
      : "🧊 System Lock-up Detected: The browser's Main Thread is unresponsive. Interaction is impossible.";
    const stackTrace = isCrash
      ? `Isolated Node health probe to ${targetUrl} failed after ${HEALTH_PROBE_TIMEOUT_MS}ms.`
      : 'Heartbeat evaluate call exceeded 5000ms timeout.';
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
      reason: isCrash ? 'Critical Server Crash' : 'Main Thread Lock-up Detected',
      url,
      stackTrace,
      steps: [],
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
        bugId: `${isCrash ? 'server-crash' : 'main-thread-lockup'}-${Date.now()}`,
        type: isCrash ? 'NETWORK' : 'RUNTIME_UI_FREEZE',
        message: banner,
        selector: '',
        payloadUsed: '',
        advice,
        timestamp: new Date(),
        attribution,
      });
    }
  };

  // Informational-only: a browser freeze was seen but the server is fine, so we
  // are attempting recovery. No finding, no forensic record — just operator signal.
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

  // Heartbeat timeout handler. A blocked browser thread is NOT proof of a server
  // outage, so before classifying anything we consult the ISOLATED Node health
  // client (immune to the browser lockup):
  //   • server up   → local browser freeze: recover briefly, re-validate stability,
  //                    resume on recovery; only a sustained freeze emits a UI finding.
  //   • server down → confirmed Critical Server Crash.
  const handleHeartbeatTimeout = async (): Promise<void> => {
    const serverUp = await isServerReachable(targetUrl, HEALTH_PROBE_TIMEOUT_MS);
    if (disposed) return;

    if (!serverUp) {
      emitFreezeFinding('server-crash');
      return;
    }

    // Server reachable → the freeze is local to the browser. Reset error state and
    // let it recover before deciding anything.
    emitInfo('⏳ Browser thread stalled but server is reachable — attempting local recovery...');
    const recovered = await validatePageStability();
    if (disposed) return;

    if (recovered) {
      emitInfo('✅ Browser thread recovered — resuming exploration (no server crash).');
    } else {
      emitFreezeFinding('ui-freeze');
    }
  };

  const runHeartbeat = async (): Promise<void> => {
    if (disposed || heartbeatInFlight || page.isClosed()) {
      return;
    }

    heartbeatInFlight = true;
    try {
      if (await threadResponsive()) return;
      // Rate-limit escalation so one sustained freeze doesn't spam the pipeline.
      const now = Date.now();
      if (now - lastHeartbeatAlertAt < HEARTBEAT_TIMEOUT_MS) return;
      lastHeartbeatAlertAt = now;
      await handleHeartbeatTimeout();
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

import type { Page } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import type { ActionRecord, FindingAttribution, StateFingerprint } from '../../../../shared/types.js';
import { classifyFault, type FaultType } from '../../bugs/knowledgeBase/index.js';
import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';
import { ActiveScenarioTracker } from './activeScenarioTracker.js';
import { captureStateFingerprint } from './stateFingerprint.js';

const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
// After a heartbeat timeout, let the browser thread settle then re-probe
// its responsiveness a bounded number of times before declaring a real UI freeze.
const RECOVERY_SETTLE_MS = 500;
const STABILITY_RETRIES = 3;
// Recovery re-probes are SHORT on purpose. A thread that genuinely recovered (a
// transient driver/GC stall) answers a trivial evaluate in well under a second; a
// full HEARTBEAT_TIMEOUT_MS re-probe instead just waits out a still-running freeze
// and reads "recovered", so any freeze shorter than ~3×5s silently escaped.
const RECOVERY_PROBE_TIMEOUT_MS = 750;
// In-page watchdog tick. A FINITE freeze that ends inside the recovery window fools
// the outside-in heartbeat, so a timer ticking INSIDE the page — itself blocked by the
// frozen main thread — measures the true block duration from the gap between ticks.
const WATCHDOG_TICK_MS = 1_000;
// A measured main-thread block at/above this is a client render freeze (CWE-835).
const FREEZE_BLOCK_THRESHOLD_MS = HEARTBEAT_TIMEOUT_MS;
// Collapse the outside-in heartbeat and the in-page watchdog (which can both fire for
// one freeze) into a single finding within this window.
const FREEZE_DEDUP_MS = 10_000;

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
 * @param isEngineStopping - True while the engine is intentionally stopping/paused; a probe
 *   that fails because BugSafari is tearing the browser down is teardown, never a UI freeze.
 */
export function setupStabilityMonitoring(
  page: Page,
  telemetry: TelemetryGateway,
  onBugRegistered?: BugRegistrationCallback,
  isEngineStopping: () => boolean = () => false,
): Cleanup {
  let disposed = false;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatInFlight = false;
  let lastHeartbeatAlertAt = 0;
  // Single chokepoint so the outside-in heartbeat and the in-page watchdog never
  // double-report one freeze.
  let lastFreezeFindingAt = 0;

  // Emit a confirmed UI-freeze finding. Genuine server faults (5xx / requestfailed
  // / pageerror) are owned solely by the primary domain StabilityMonitor, so this
  // detector only ever reports a sustained local browser lock-up. `blockMs`, when
  // known (in-page watchdog), is the measured main-thread block duration.
  const emitFreezeFinding = async (faultAtMs: number, blockMs?: number): Promise<void> => {
    const nowMs = Date.now();
    if (nowMs - lastFreezeFindingAt < FREEZE_DEDUP_MS) return;
    lastFreezeFindingAt = nowMs;

    const timestamp = new Date().toISOString();
    const url = page.url();
    const reproduction = ActiveScenarioTracker.flushSnapshot({ faultUrl: url, faultAtMs });
    const reproductionPlaybook = reproduction.narrative;
    // Renderer is unresponsive during a freeze — capture cookies only (no storage evaluate).
    const stateFingerprint = await captureStateFingerprint(page, { cookiesOnly: true });

    const faultType: FaultType = 'FREEZE';
    const seconds = blockMs ? Math.round(blockMs / 1000) : undefined;
    const reason = `Client render freeze: the main thread was blocked${seconds ? ` for ~${seconds}s` : ''}, so the page could not respond to input or repaint.`;
    const banner = ` ${reason} Interaction is impossible while it lasts.`;
    const stackTrace = blockMs
      ? `In-page watchdog measured a ${Math.round(blockMs)}ms main-thread tick gap (threshold ${FREEZE_BLOCK_THRESHOLD_MS}ms).`
      : `Heartbeat evaluate call exceeded ${HEARTBEAT_TIMEOUT_MS}ms timeout.`;
    // A sustained, measured main-thread lock-up IS a client render freeze (CWE-835),
    // not a generic stability exception — attribute it explicitly (bug class + CWE +
    // remediation from the catalog) while keeping scenario/step from the classifier.
    const { attribution: scenarioAttribution } = classify(faultType, reason, { url });
    const advice = BUG_CATALOG.CLIENT_RENDER_FREEZE.remediation;
    const attribution: FindingAttribution = {
      ...scenarioAttribution,
      bugClass: 'CLIENT_RENDER_FREEZE',
      cwe: BUG_CATALOG.CLIENT_RENDER_FREEZE.cwe,
    };

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

  // A failed probe during intentional teardown (disposed, page closed, or engine
  // stopping/paused) is an expected shutdown artifact — never a target-app freeze.
  const isTeardown = (): boolean => disposed || page.isClosed() || isEngineStopping();

  const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  };

  // Probe the main thread once; true if it answered within the timeout.
  const threadResponsive = async (timeoutMs: number = HEARTBEAT_TIMEOUT_MS): Promise<boolean> => {
    if (disposed || page.isClosed()) return false;
    try {
      await withTimeout(page.evaluate(() => true), timeoutMs);
      return true;
    } catch {
      return false;
    }
  };

  // Give the browser a brief window to recover, re-validating page stability a
  // bounded number of times. Re-probes use a SHORT timeout so a thread still wedged
  // answers slowly enough to fail — a full re-probe would just block until the freeze
  // ended and mislabel a real multi-second lock-up as "recovered". Returns true only
  // when the main thread answers a short probe, i.e. it genuinely recovered.
  const validatePageStability = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < STABILITY_RETRIES; attempt += 1) {
      if (disposed || page.isClosed()) return false;
      await sleep(RECOVERY_SETTLE_MS);
      if (await threadResponsive(RECOVERY_PROBE_TIMEOUT_MS)) return true;
    }
    return false;
  };

  // Heartbeat timeout handler. A blocked browser thread is a local freeze — give
  // it a brief window to recover before declaring a sustained UI lock-up. Real
  // server outages are caught by the primary StabilityMonitor's 5xx/requestfailed
  // /pageerror listeners, not this heartbeat.
  const handleHeartbeatTimeout = async (faultAtMs: number): Promise<void> => {
    if (isTeardown()) return;
    emitInfo(' Browser thread stalled — attempting local recovery...');
    const recovered = await validatePageStability();
    // Re-check after the recovery window: a stop/close that landed mid-probe makes the
    // stall an expected shutdown artifact, so suppress the finding entirely.
    if (isTeardown()) return;

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
      // The probe can fail simply because the engine closed the browser out from under it
      // (operator stop / cancel / pause) — that is teardown, not an application lock-up.
      if (isTeardown()) return;
      // Rate-limit escalation so one sustained freeze doesn't spam the pipeline.
      const now = Date.now();
      if (now - lastHeartbeatAlertAt < HEARTBEAT_TIMEOUT_MS) return;
      lastHeartbeatAlertAt = now;
      await handleHeartbeatTimeout(probeStartedAt);
    } finally {
      heartbeatInFlight = false;
    }
  };

  // In-page main-thread watchdog. The outside-in heartbeat above can be fooled by a
  // FINITE freeze that ends inside its recovery window (the probe just waits the freeze
  // out and reads "recovered"). A timer ticking INSIDE the page is itself blocked by the
  // frozen main thread, so the gap between two ticks IS the block duration — measured in
  // the target, immune to CDP/driver timing and to zero-interaction driver-wait timeouts.
  // It fires once the thread resumes (only then can the timer run), which is exactly when
  // the freeze can be reported. A pure driver/Playwright timeout produces no in-page gap,
  // so it can never manufacture a false freeze here.
  const onMainThreadStall = (gapMs: number): void => {
    if (isTeardown()) return;
    if (typeof gapMs !== 'number' || !Number.isFinite(gapMs) || gapMs < FREEZE_BLOCK_THRESHOLD_MS) return;
    // Onset = now minus the measured block; anchors the reproduction before the freeze.
    void emitFreezeFinding(Date.now() - Math.round(gapMs), gapMs);
  };
  // Installs the ticking watchdog in a document. Idempotent per document. The reporter
  // hook is read lazily (at tick time), so it works even if exposeFunction has not yet
  // finished binding when this first runs.
  const installWatchdog = ([tickMs, thresholdMs]: [number, number]): void => {
    const w = window as unknown as { __bugsafariFreezeWatch?: boolean; __bugsafariOnMainThreadStall?: (g: number) => void };
    if (w.__bugsafariFreezeWatch) return;
    w.__bugsafariFreezeWatch = true;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      // A gap far past the tick interval means the main thread was blocked that long.
      if (gap >= thresholdMs) {
        try {
          w.__bugsafariOnMainThreadStall?.(gap);
        } catch {
          // never let the reporter hook throw inside the page
        }
      }
    }, tickMs);
  };
  const watchdogArgs: [number, number] = [WATCHDOG_TICK_MS, FREEZE_BLOCK_THRESHOLD_MS];
  page.exposeFunction('__bugsafariOnMainThreadStall', onMainThreadStall).catch(() => undefined);
  // Monitoring attaches AFTER navigation (see attachAfterNavigation), so the target
  // document is already loaded — inject now. addInitScript covers any later full-document
  // load; both are guarded idempotent so an SPA never stacks two watchdog intervals.
  page.evaluate(installWatchdog, watchdogArgs).catch(() => undefined);
  page.addInitScript(installWatchdog, watchdogArgs).catch(() => undefined);

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

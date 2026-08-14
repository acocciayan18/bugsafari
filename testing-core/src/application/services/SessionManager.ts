import type { Socket } from 'socket.io';
import { Types, isValidObjectId } from 'mongoose';
import type {
  AccessibilityFinding,
  ActiveSessionSnapshot,
  BrowserConsoleMessage,
  ForensicCrashReport,
  IncidentReport,
  ReproductionVerdict,
  RunLifecycleStatus,
  SessionAttachAck,
  RunTerminationOutcome,
  SessionOwnerType,
  StopReason,
  TelemetryEvent,
} from '../../../../shared/types.js';
import { SESSION_SNAPSHOT_EVENT, NETWORK_ACTION } from '../../../../shared/types.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { SocketTelemetryGateway, TelemetryRecordKind, TelemetryRecorder } from '../../infrastructure/socket/SocketTelemetryGateway.js';
import { TargetHealthMonitor } from './TargetHealthMonitor.js';
import { ownsRun } from './runOwnership.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { NetworkQuarantine } from '../../infrastructure/monitoring/NetworkQuarantine.js';
import type { OperatorCommand } from '../../infrastructure/queue/controlBridge.js';

import { createLogger } from '../../infrastructure/observability/logger.js';
import { telemetryEventRepository, type TelemetryEventRow } from '../../infrastructure/database/repositories/TelemetryEventRepository.js';
import { MAX_FORENSIC_ROWS } from '../../infrastructure/database/queryLimits.js';

const obsLog = createLogger('[SessionManager]');

/** Minimal control surface the manager needs from the live browser engine. */
export interface EngineControl {
  pause?: () => void;
  resume?: () => void;
  // `reason` names the stop trigger so the run's terminal outcome is attributed
  // to its real cause instead of defaulting to operator intent.
  stop?: (reason?: StopReason) => Promise<void> | void;
  // Settlement barrier: flush in-flight telemetry/DB writes before the state settles.
  settlePendingTasks?: () => Promise<void>;
  getElapsedActiveTimeMs?: () => number;
  getLastSessionId?: () => string | null;
}

export interface BeginRunParams {
  runToken: string;             // opaque bearer token: room key + ownership proof
  runCode: string;              // public RUN- code surfaced to the operator
  userId: string | null;        // authenticated owner id, or null for a guest run
  targetUrl: string;
  timeboxMs: number;
  engine: EngineControl;
}

export interface ReserveRunParams extends Omit<BeginRunParams, 'engine'> {
  // Invoked if the engine never calls beginRun before the reservation expires, so
  // the caller can release whatever admission slot it claimed.
  onAbandoned?: () => void;
}

// Env-tunable knobs (all optional; safe defaults).
const GRACE_MS = readPositiveInt(process.env.BUGSAFARI_SESSION_GRACE_MS, 60_000);
// Legacy resource-reclaim teardown of an abandoned run. OFF by default so a network
// drop or closed tab never terminates an autonomous run — the timebox / MAX_PAUSE_MS
// remain the sole terminators. Set to 'on' to restore the grace-expiry engine stop.
const TERMINATE_ON_ABANDON = process.env.BUGSAFARI_TERMINATE_ON_ABANDON?.trim().toLowerCase() === 'on';
const HEALTH_INTERVAL_MS = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_INTERVAL_MS, 15_000);
const HEALTH_TIMEOUT_MS = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_TIMEOUT_MS, 5_000);
// Consecutive failed probes before declaring a Critical Server Crash and terminating.
const HEALTH_CRASH_THRESHOLD = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_CRASH_THRESHOLD, 3);
// Consecutive failed probes before pausing exploration (transient outage). Kept
// below the crash threshold so a genuine blip pauses+auto-resumes before any kill.
const HEALTH_DEGRADE_THRESHOLD = clampBelow(
  readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_DEGRADE_THRESHOLD, 2),
  HEALTH_CRASH_THRESHOLD,
);
// The health probe runs in the Node process, whose in-container network view can
// differ from the Playwright browser's (proxy, DNS and egress rules differ).
// A Node probe that can't reach a target the browser CAN
// would falsely crash the run, so the kill-switch is OFF by default — genuine
// server failures are still caught browser-side (5xx / requestfailed / pageerror).
// Enable only where the engine process and the browser share the target's network.
const HEALTH_MONITOR_ENABLED = process.env.BUGSAFARI_TARGET_HEALTH_MONITOR?.trim().toLowerCase() === 'on';
// How long a reserved room may wait for its engine to call beginRun before the
// run is declared stillborn. Must exceed a cold Playwright launch (30s race in
// PlaywrightBrowserEngine) with headroom for the pre-launch imports.
const RESERVATION_TIMEOUT_MS = readPositiveInt(process.env.BUGSAFARI_RESERVATION_TIMEOUT_MS, 45_000);
// Absolute cap on how long a run may sit PAUSED. The timebox counts active time only,
// so a connected operator who pauses and stays connected (grace never fires) would pin
// the browser + fleet slot forever. On expiry the run auto-stops via the normal path.
const MAX_PAUSE_MS = readPositiveInt(process.env.BUGSAFARI_MAX_PAUSE_MS, 600_000);
// Hard ceiling on a graceful stop. A hung engine.stop() (browser.close / a stuck
// settlePendingTasks) or a run() that never observes cancellation would otherwise
// pin the singleton — and its in-process admission slot — for the process lifetime,
// blocking every later launch even across logout/login. On expiry the run is
// force-released: the terminal IDLE handshake is emitted, the lifecycle settles, and
// the slot frees. Trade-off: a genuinely-stuck run is abandoned (its browser may leak)
// so a new test can start — chosen deliberately over a permanent lock.
const STOP_TIMEOUT_MS = readPositiveInt(process.env.BUGSAFARI_STOP_TIMEOUT_MS, 20_000);
const TELEMETRY_BUFFER_CAP = 500;
const REPORT_BUFFER_CAP = 100;
const CONSOLE_BUFFER_CAP = 200;
// Batch size before draining the telemetry-event persist buffer to Mongo. Keeps the
// durable stream write off the hot path — record() only appends; the flush is chained.
const TELEMETRY_PERSIST_FLUSH = 25;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Keep a threshold strictly below its ceiling so degrade always precedes crash.
function clampBelow(value: number, ceiling: number): number {
  return value < ceiling ? value : Math.max(1, ceiling - 1);
}

interface ActiveRun {
  runToken: string;   // opaque bearer token: room key + ownership proof
  runCode: string;    // public RUN- code surfaced to the operator
  userId: string | null;
  // Tenant key that is unique even for guests, so two anonymous operators are
  // never treated as the same principal by a null===null comparison.
  ownerKey: string;
  ownerType: SessionOwnerType;
  targetUrl: string;
  currentUrl: string;
  timeboxMs: number;
  startedAt: number;
  engine: EngineControl;
  status: RunLifecycleStatus;
  room: string;
  ownerSocketIds: Set<string>;
  manualPaused: boolean;   // paused by the operator
  networkPaused: boolean;  // auto-paused by the target-health monitor (transient outage)
  // A resume that raced in while a pause was still settling (status PAUSING). The
  // resume is dropped there (the transition isn't done); this latch replays it the
  // instant pauseByOperator settles, so rapid pause→resume can't strand the run paused.
  pendingResume: boolean;
  crashTerminated: boolean; // target server crash confirmed; run being torn down
  // Why the run ended, captured off the terminal telemetry event. Held on the run
  // (not derived from the capped replay buffer) so a restore is always accurate.
  terminationOutcome: RunTerminationOutcome | null;
  terminationReason: string | null;
  health: TargetHealthMonitor;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // Armed the moment a stop is dispatched; force-releases the run if it hasn't torn
  // down within STOP_TIMEOUT_MS (a hung engine.stop / non-unwinding run()). Cleared
  // in teardownRun so a clean stop never trips it.
  stopWatchdogTimer: ReturnType<typeof setTimeout> | null;
  // Armed when the run settles to PAUSED; expiry auto-stops it. Cleared on resume,
  // stop, and teardown so only a genuinely-abandoned pause reaches the deadline.
  pauseDeadlineTimer: ReturnType<typeof setTimeout> | null;
  // Armed while STARTING; disarmed by beginRun. Expiry declares the run stillborn.
  reservationTimer: ReturnType<typeof setTimeout> | null;
  // A stop issued while STARTING has no engine to reach — remembered so beginRun
  // honours it the moment the real engine attaches (no zombie run).
  pendingStop: boolean;
  // The reason carried by that deferred stop, replayed with it so a timebox/shutdown
  // stop during boot is not silently re-attributed to the operator.
  pendingStopReason: StopReason;
  // Forensic run id, resolved lazily from the engine once the session doc exists;
  // the key under which the durable telemetry stream is persisted + restored.
  sessionId: string | null;
  // Durable telemetry-event persistence state (batched, backend-direct to Mongo).
  telemetrySeq: number;
  telemetryPersistBuffer: TelemetryEventRow[];
  telemetryPersistedCount: number;
  telemetryFlushChain: Promise<void>;
  // One-shot latch: true once the durable cap was hit and the operator was told the
  // DB tail is truncated, so the warning is emitted once, not per dropped event.
  telemetryCapSignaled: boolean;
  // Replay ring buffers (bounded).
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  accessibility: AccessibilityFinding[];
  browserConsole: BrowserConsoleMessage[];
  lastFrame: string | null;
}

/**
 * Centralized owner of the single active exploration run: lifecycle state
 * machine, reconnect replay buffer, disconnect grace window, Socket.IO room
 * wiring, and target-health-driven pause/resume. Replaces the scattered
 * `activeEngineSession` globals that previously lived in registerSocketHandlers.
 * A singleton — one run at a time, matching the 429-busy admission model.
 */
export class SessionManager implements TelemetryRecorder {
  private gateway: SocketTelemetryGateway | null = null;
  private run: ActiveRun | null = null;
  // Monotonic revision of the snapshot's non-frame content, bumped on every
  // meaningful record(). The worker's periodic publisher skips the Redis write when
  // it is unchanged since the last publish — the bulk of ticks change nothing but
  // the live frame, which the periodic snapshot deliberately omits.
  private snapshotRevision = 0;
  // Final snapshot of the most recently ended run, kept until the next run
  // begins so a refresh restores the completed/stopped state instead of IDLE.
  private lastTerminal: { snapshot: ActiveSessionSnapshot; userId: string | null } | null = null;
  // Frees the in-process admission slot on a force-release. Set by the API process
  // (→ useCase.releaseActivation); left null in the worker, whose slot is the BullMQ
  // job itself and settles when the processor returns.
  private onRelease: (() => void) | null = null;
  // Stops that arrived for a run token before its engine began executing. The worker
  // reaches beginRun() only after async boot (SSRF re-check, vault open, Chromium
  // launch); a stop bridged in during that window has no run to act on and was
  // dropped, so the run explored to its full timebox and pinned the worker slot —
  // stranding the next launch behind it in a false queue. Remembered here, keyed by
  // runToken, and applied the instant beginRun() attaches the real engine.
  private pendingStops = new Map<string, StopReason>();
  // Bound so a stop for a run that never begins (e.g. a boot that throws before
  // beginRun) cannot accumulate entries. Concurrency is 1 per process, so one live
  // token is the norm; the cap is a pure leak backstop.
  private static readonly PENDING_STOP_CAP = 16;

  /** Wire the manager to the shared telemetry gateway (room-scoped emitter). */
  public initialize(gateway: SocketTelemetryGateway): void {
    this.gateway = gateway;
  }

  /** Register the callback that frees the admission slot when a run is force-released. */
  public setActivationReleaser(release: (() => void) | null): void {
    this.onRelease = release;
  }

  public get graceMs(): number {
    return GRACE_MS;
  }

  /** Whether an abandoned run (no client for graceMs) is torn down. Off by default. */
  public get terminateOnAbandon(): boolean {
    return TERMINATE_ON_ABANDON;
  }

  public hasActiveRun(): boolean {
    return this.run !== null;
  }

  /** Engine control surface of the active run (used by the HTTP stop endpoint). */
  public getActiveEngine(): EngineControl | null {
    return this.run?.engine ?? null;
  }

  /** Unique tenant key of the active run (guests included), or null. */
  public getActiveOwnerKey(): string | null {
    return this.run?.ownerKey ?? null;
  }

  /** The single ownership probe for HTTP and socket callers alike. */
  public ownsActiveRun(userId: string | null, runId: string | undefined): boolean {
    return this.run ? this.isOwner(this.run, runId, userId) : false;
  }

  // ── Run lifecycle ────────────────────────────────────────────────────────

  /**
   * Create the run's room and replay buffers BEFORE the engine exists, so the
   * HTTP response can be sent knowing a client that attaches immediately will
   * join a room that is already there. Without this the client raced the engine's
   * async boot, got `no-active-session`, and stayed deaf for the entire run.
   */
  public reserveRun(params: ReserveRunParams): void {
    if (this.run) this.teardownRun();

    this.run = this.createRun({
      ...params,
      // Placeholder control surface: a stop arriving during boot is recorded
      // rather than dropped, and replayed against the real engine in beginRun.
      engine: {
        stop: (reason?: StopReason) => {
          if (this.run?.runToken === params.runToken) {
            this.run.pendingStop = true;
            this.run.pendingStopReason = reason ?? 'operator';
          }
        },
        getElapsedActiveTimeMs: () => 0,
      },
    }, 'STARTING');

    this.run.reservationTimer = setTimeout(() => {
      const run = this.run;
      if (!run || run.runToken !== params.runToken || run.status !== 'STARTING') return;
      obsLog.error(`[SessionManager] Run ${run.runToken} never started within ${RESERVATION_TIMEOUT_MS}ms — declaring it stillborn.`);
      this.emitFailure(`Engine failed to start within ${Math.round(RESERVATION_TIMEOUT_MS / 1000)}s. The session was cancelled and all resources released.`);
      this.endRun('CRASHED', params.runToken);
      params.onAbandoned?.();
    }, RESERVATION_TIMEOUT_MS);

    this.gateway?.setRoom(this.run.room);
    this.gateway?.setRecorder(this);
    obsLog.info(`[SessionManager] Run ${params.runToken} reserved (room ready, awaiting engine).`);
  }

  public beginRun(params: BeginRunParams): void {
    // Upgrade a reservation in place: same room, same buffers, so telemetry
    // emitted during boot is not discarded and attached sockets stay attached.
    const reserved = this.run;
    if (reserved && reserved.runToken === params.runToken && reserved.status === 'STARTING') {
      if (reserved.reservationTimer) {
        clearTimeout(reserved.reservationTimer);
        reserved.reservationTimer = null;
      }
      reserved.engine = params.engine;
      reserved.timeboxMs = params.timeboxMs;
      reserved.userId = params.userId;
      reserved.ownerKey = guestOwnerKey(params.userId, params.runToken);
      reserved.ownerType = params.userId ? 'authenticated' : 'guest';
      reserved.status = 'RUNNING';
      if (HEALTH_MONITOR_ENABLED) reserved.health.start();
      obsLog.info(`[SessionManager] Run ${params.runToken} started from reservation (${reserved.ownerType}, target=${params.targetUrl}).`);
      // Honour a stop the operator issued while the engine was still booting — from
      // the reservation's own placeholder (in-process path) or bridged in before the
      // engine attached (worker path).
      const bridged = this.consumePendingStop(params.runToken);
      const deferredReason = bridged ?? (reserved.pendingStop ? reserved.pendingStopReason : undefined);
      reserved.pendingStop = false;
      if (deferredReason) this.scheduleDeferredStop(params.runToken, deferredReason);
      return;
    }

    // Defensive: never leak a previous run's timers/monitors if begin is called
    // without a matching end (shouldn't happen under the 429 admission guard).
    if (this.run) {
      this.teardownRun();
    }

    this.run = this.createRun(params, 'RUNNING');
    this.lastTerminal = null;
    this.gateway?.setRoom(this.run.room);
    this.gateway?.setRecorder(this);
    if (HEALTH_MONITOR_ENABLED) this.run.health.start();
    obsLog.info(`[SessionManager] Run ${params.runToken} started (${this.run.ownerType}, target=${params.targetUrl}, grace=${GRACE_MS}ms, healthMonitor=${HEALTH_MONITOR_ENABLED ? 'on' : 'off'})`);
    // Apply a stop bridged in before the engine attached (worker boot window).
    const bridged = this.consumePendingStop(params.runToken);
    if (bridged) this.scheduleDeferredStop(params.runToken, bridged);
  }

  // Apply a boot-time stop AFTER the engine's run loop is live, not inline here.
  // engine.run() clears the cancellation tags at its very start, so a stop dispatched
  // synchronously from beginRun (before run() executes) is wiped and lost. Deferring
  // to the next event-loop turn lands it exactly where a normal in-run stop lands —
  // once the browser launch is in flight — so the engine's rapid-cancellation path
  // tears the run down and attributes it to the real reason.
  private scheduleDeferredStop(runToken: string, reason: StopReason): void {
    obsLog.info(`[SessionManager] Run ${runToken} had a stop pending from boot — applying once its run loop is live.`);
    setImmediate(() => {
      if (this.run?.runToken !== runToken) return; // run already ended/replaced
      void this.stopByOperator(reason);
    });
  }

  // Remember a stop for a run whose engine has not attached yet, and hand it back
  // once at beginRun. Keyed by runToken so a stale stop for a run that never begins
  // never lands on a later run (tokens are unique per run).
  private rememberPendingStop(runToken: string, reason: StopReason): void {
    if (this.pendingStops.size >= SessionManager.PENDING_STOP_CAP) {
      const oldest = this.pendingStops.keys().next().value;
      if (oldest !== undefined) this.pendingStops.delete(oldest);
    }
    this.pendingStops.set(runToken, reason);
    obsLog.info(`[SessionManager] Stop for run ${runToken} arrived before it began — deferring to beginRun.`);
  }

  private consumePendingStop(runToken: string): StopReason | undefined {
    const reason = this.pendingStops.get(runToken);
    if (reason !== undefined) this.pendingStops.delete(runToken);
    return reason;
  }

  private createRun(params: BeginRunParams, status: RunLifecycleStatus): ActiveRun {
    const room = `run:${params.runToken}`;
    const health = new TargetHealthMonitor(params.targetUrl, HEALTH_INTERVAL_MS, HEALTH_TIMEOUT_MS, {
      onCrash: (failures) => void this.onTargetCrash(failures),
      onDegraded: (failures) => void this.onTargetDegraded(failures),
      onRecovered: () => void this.onTargetRecovered(),
    }, HEALTH_CRASH_THRESHOLD, HEALTH_DEGRADE_THRESHOLD);

    // A fresh run supersedes any previously retained final state.
    this.lastTerminal = null;

    return {
      runToken: params.runToken,
      runCode: params.runCode,
      userId: params.userId,
      ownerKey: guestOwnerKey(params.userId, params.runToken),
      ownerType: params.userId ? 'authenticated' : 'guest',
      targetUrl: params.targetUrl,
      currentUrl: params.targetUrl,
      timeboxMs: params.timeboxMs,
      startedAt: Date.now(),
      engine: params.engine,
      status,
      room,
      ownerSocketIds: new Set<string>(),
      manualPaused: false,
      networkPaused: false,
      pendingResume: false,
      pauseDeadlineTimer: null,
      crashTerminated: false,
      terminationOutcome: null,
      terminationReason: null,
      health,
      graceTimer: null,
      stopWatchdogTimer: null,
      reservationTimer: null,
      pendingStop: false,
      pendingStopReason: 'operator',
      sessionId: null,
      telemetrySeq: 0,
      telemetryPersistBuffer: [],
      telemetryPersistedCount: 0,
      telemetryFlushChain: Promise.resolve(),
      telemetryCapSignaled: false,
      telemetry: [],
      reports: [],
      incidents: [],
      accessibility: [],
      browserConsole: [],
      lastFrame: null,
    };
  }

  // Terminal failure notice for a run that never produced engine telemetry —
  // gives the dashboard the same EXCEPTION + IDLE handshake a real run ends with,
  // so no client is ever left waiting on a stream that will never open.
  private emitFailure(message: string): void {
    this.gateway?.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: { message },
    });
    this.gateway?.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: { actionExecuted: 'engine-status', message: 'IDLE' },
    });
  }

  /**
   * A caller settling a run must be settling the run it started. Several call
   * sites reach here after an await (crash termination, a fire-and-forget catch),
   * by which time the operator may already have launched the NEXT run — and
   * tearing that one down would unbind its telemetry room mid-boot, leaving it
   * unroutable and unbuffered for its whole timebox. Mirrors the grace timer's
   * own runToken check.
   */
  private isStaleSettle(runToken: string | undefined, label: string): boolean {
    if (!this.run || runToken === undefined || runToken === this.run.runToken) return false;
    obsLog.warn(`[SessionManager] Ignoring stale ${label} for run ${runToken} — run ${this.run.runToken} is active now.`);
    return true;
  }

  /** Publish a terminal failure for the active run and release it. */
  public failRun(message: string, runToken?: string): void {
    if (!this.run || this.isStaleSettle(runToken, 'failRun')) return;
    this.emitFailure(message);
    this.endRun('CRASHED', runToken);
  }

  /** Called from the run's finally block when the engine loop returns/throws. */
  public endRun(finalStatus: RunLifecycleStatus = 'COMPLETED', ownerRunToken?: string): void {
    if (!this.run || this.isStaleSettle(ownerRunToken, 'endRun')) return;
    const { runToken } = this.run;
    // A confirmed server crash is terminal — the normal run-completion path must
    // not downgrade it back to COMPLETED when the stopped engine unwinds.
    const status: RunLifecycleStatus = this.run.crashTerminated ? 'CRASH_COMPLETED' : finalStatus;
    this.run.status = status;
    void this.persistStatus(status);
    // Retain the final state so a post-completion refresh can restore it.
    this.lastTerminal = { snapshot: this.buildSnapshot(this.run), userId: this.run.userId };
    this.teardownRun();
    obsLog.info(`[SessionManager] Run ${runToken} ended (${status})`);
  }

  private teardownRun(): void {
    if (!this.run) return;
    this.flushTelemetryEvents(this.run); // best-effort drain of the final sub-batch
    this.run.health.stop();
    // Clear the process-wide degraded flag so a reused worker never inherits it.
    NetworkQuarantine.reset();
    if (this.run.graceTimer) {
      clearTimeout(this.run.graceTimer);
      this.run.graceTimer = null;
    }
    if (this.run.stopWatchdogTimer) {
      clearTimeout(this.run.stopWatchdogTimer);
      this.run.stopWatchdogTimer = null;
    }
    if (this.run.reservationTimer) {
      clearTimeout(this.run.reservationTimer);
      this.run.reservationTimer = null;
    }
    this.clearPauseDeadline(this.run);
    this.gateway?.setRoom(null);
    this.gateway?.setRecorder(null);
    this.run = null;
  }

  private clearPauseDeadline(run: ActiveRun): void {
    if (run.pauseDeadlineTimer) {
      clearTimeout(run.pauseDeadlineTimer);
      run.pauseDeadlineTimer = null;
    }
  }

  // Auto-stop a run left paused past MAX_PAUSE_MS so an idle pause can't pin the
  // browser + fleet slot indefinitely (the timebox counts active time only).
  private armPauseDeadline(run: ActiveRun): void {
    this.clearPauseDeadline(run);
    run.pauseDeadlineTimer = setTimeout(() => {
      if (this.run !== run) return;
      obsLog.info(`[SessionManager] Run ${run.runToken} exceeded max pause (${MAX_PAUSE_MS}ms) — auto-stopping.`);
      this.emitMilestone(`Session auto-stopped — paused longer than the ${Math.round(MAX_PAUSE_MS / 1000)}s maximum.`);
      void this.stopByOperator('pause-timeout');
    }, MAX_PAUSE_MS);
    run.pauseDeadlineTimer.unref();
  }

  // ── TelemetryRecorder: buffer every outbound payload for reconnect replay ──

  public record(kind: TelemetryRecordKind, payload: unknown): void {
    const run = this.run;
    if (!run) return;

    // A live-frame changes only lastFrame, which the periodic snapshot omits, so it
    // must not mark the snapshot dirty — otherwise the dirty-flag never settles and
    // every 3s tick rewrites an unchanged payload. Every other kind mutates snapshot
    // content (buffers, currentUrl, incident patches) and bumps the revision.
    if (kind !== 'live-frame') this.snapshotRevision += 1;

    switch (kind) {
      case 'telemetry':
        pushCapped(run.telemetry, payload as TelemetryEvent, TELEMETRY_BUFFER_CAP);
        this.persistTelemetryEvent(run, payload as TelemetryEvent);
        this.observeTerminationFrom(payload as TelemetryEvent);
        this.observeStatusFrom(payload as TelemetryEvent);
        break;
      case 'url-changed':
        if (typeof payload === 'string') run.currentUrl = payload;
        break;
      case 'live-frame':
        // Only the newest frame is retained — replaying a full frame history
        // would blow the buffer and is pointless (the stream resumes live).
        if (typeof payload === 'string') run.lastFrame = payload;
        break;
      case 'forensic-report':
        pushCapped(run.reports, payload as ForensicCrashReport, REPORT_BUFFER_CAP);
        break;
      case 'incident-report':
        pushCapped(run.incidents, payload as IncidentReport, REPORT_BUFFER_CAP);
        break;
      case 'accessibility':
        pushCapped(run.accessibility, payload as AccessibilityFinding, REPORT_BUFFER_CAP);
        break;
      case 'browser-console':
        pushCapped(run.browserConsole, payload as BrowserConsoleMessage, CONSOLE_BUFFER_CAP);
        break;
      case 'reproduction-verdict':
        // Patched into the buffered incident rather than buffered separately, so a
        // reconnect replays the already-corrected card and needs no event ordering.
        this.applyReproductionVerdict(payload as ReproductionVerdict);
        break;
    }
  }

  /** Fold a late reproduction verdict into the buffered incident it belongs to. */
  private applyReproductionVerdict(verdict: ReproductionVerdict): void {
    const run = this.run;
    if (!run || !verdict?.bugId) return;
    const incident = run.incidents.find((entry) => entry.bugId === verdict.bugId);
    if (!incident?.attribution) return;
    incident.attribution = {
      ...incident.attribution,
      confidenceScore: verdict.confidenceScore,
      verificationStatus: verdict.verificationStatus,
    };
  }

  // Buffer a telemetry event for durable, batched persistence to Mongo — the
  // full-stream backing that outlives the capped in-memory replay buffer. Runs in
  // whichever process owns the engine (API in-proc, or the worker in queue mode).
  private persistTelemetryEvent(run: ActiveRun, event: TelemetryEvent): void {
    if (run.sessionId === null) run.sessionId = run.engine.getLastSessionId?.() ?? null;
    if (run.sessionId === null) return; // pre-session boot; the in-memory buffer still covers it
    if (run.telemetryPersistedCount + run.telemetryPersistBuffer.length >= MAX_FORENSIC_ROWS) {
      // Cap hit: keep streaming live, but tell the operator once that the durable DB
      // record stops here — a restored session must never look complete when it isn't.
      if (!run.telemetryCapSignaled) {
        run.telemetryCapSignaled = true;
        obsLog.warn(`[SessionManager] Durable telemetry cap (${MAX_FORENSIC_ROWS}) reached — live stream continues; DB tail truncated.`);
        this.emitMilestone(
          `Forensic persistence cap (${MAX_FORENSIC_ROWS} events) reached — live telemetry continues, but the durable record is truncated from here; a restored session will omit later events.`,
        );
      }
      return;
    }
    run.telemetryPersistBuffer.push({
      seq: run.telemetrySeq++,
      timestamp: new Date(event.timestamp),
      type: event.type,
      meta: event.meta,
    });
    if (run.telemetryPersistBuffer.length >= TELEMETRY_PERSIST_FLUSH) this.flushTelemetryEvents(run);
  }

  // Drain the telemetry-persist buffer to Mongo in one batch. Serialized onto a
  // per-run chain so concurrent drains can't interleave; never throws.
  private flushTelemetryEvents(run: ActiveRun): void {
    if (!run.sessionId || run.telemetryPersistBuffer.length === 0) return;
    const batch = run.telemetryPersistBuffer;
    run.telemetryPersistBuffer = [];
    const sessionId = run.sessionId;
    run.telemetryFlushChain = run.telemetryFlushChain.then(async () => {
      try {
        await telemetryEventRepository.createMany(sessionId, batch);
        run.telemetryPersistedCount += batch.length;
      } catch (error) {
        obsLog.error('[SessionManager] Failed to persist telemetry events:', error);
      }
    });
  }

  // Pin the termination the moment the engine declares one, so the reason survives
  // independently of the capped telemetry buffer that carried it. First one wins —
  // a later teardown event must not overwrite the real cause.
  private observeTerminationFrom(event: TelemetryEvent): void {
    const run = this.run;
    if (!run || run.terminationOutcome || !event.meta?.terminationOutcome) return;
    run.terminationOutcome = event.meta.terminationOutcome;
    // Prefer the bare reason; fall back to the composed message for legacy events.
    run.terminationReason = event.meta.terminationReason ?? event.meta.message ?? null;
  }

  // Track PAUSEDRUNNING from the engine's own pause/resume telemetry so a
  // reattaching client sees the true state even after an operator pause.
  private observeStatusFrom(event: TelemetryEvent): void {
    const run = this.run;
    if (!run || run.crashTerminated || event.type !== 'ACTION') return; // crash is terminal
    // The orchestrated transitional states own the status until they settle — engine
    // telemetry must not race them back to a premature PAUSED/RUNNING.
    if (run.status === 'PAUSING' || run.status === 'STOPPING') return;
    const action = event.meta.actionExecuted;
    if (action === 'engine-paused') run.status = 'PAUSED';
    else if (action === 'engine-resumed') run.status = 'RUNNING';
  }

  // ── Reconnect / attach ────────────────────────────────────────────────────

  /** Handle a socket presenting itself as the owner of `runId` (re)connecting. */
  public attach(socket: Socket, runId: string | undefined, userId: string | null): SessionAttachAck {
    const run = this.run;
    if (!run) {
      return { attached: false, reason: 'no-active-session' };
    }
    if (!this.isOwner(run, runId, userId)) {
      return { attached: false, reason: 'not-owner' };
    }

    void socket.join(run.room);
    run.ownerSocketIds.add(socket.id);

    // A returning owner cancels the grace teardown and lifts INTERRUPTED back to
    // its live state (PAUSED if the operator had paused, else RUNNING).
    if (run.graceTimer) {
      clearTimeout(run.graceTimer);
      run.graceTimer = null;
    }
    if (run.status === 'INTERRUPTED') {
      run.status = run.manualPaused ? 'PAUSED' : 'RUNNING';
      void this.persistStatus(run.status);
      this.emitMilestone(` Operator reconnected — session restored (${run.status.toLowerCase()}).`);
    }

    return { attached: true, snapshot: this.buildSnapshot(run) };
  }

  /**
   * Ownership check, delegated to the shared rule so attach (socket) and restore
   * (HTTP) can never disagree. Both transports now carry a verified identity: the
   * Socket.IO handshake presents the JWT and registerSocketHandlers verifies it,
   * so an authenticated run no longer has to accept bare token possession.
   */
  private isOwner(run: ActiveRun, runId: string | undefined, userId: string | null): boolean {
    return ownsRun({ runToken: run.runToken, userId: run.userId }, runId, userId);
  }

  /** Unscoped snapshot of the active run — worker-side Redis publishing only.
   *  `includeFrame=false` drops lastFrame for the periodic publish (the largest
   *  component, and a restoring client barely needs a stale JPEG). */
  public getActiveSnapshot(includeFrame = true): ActiveSessionSnapshot | null {
    if (!this.run) return null;
    const snapshot = this.buildSnapshot(this.run);
    return includeFrame ? snapshot : { ...snapshot, lastFrame: null };
  }

  /** Cheap identity + dirty-flag of the active run's snapshot — no buffer copies.
   *  Lets the worker's periodic publisher skip a Redis write when nothing changed. */
  public getActiveSnapshotMeta(): { runToken: string; revision: number } | null {
    return this.run ? { runToken: this.run.runToken, revision: this.snapshotRevision } : null;
  }

  /** Terminal snapshot of the last ended run — worker-side Redis publishing only. */
  public getLastTerminalSnapshot(): ActiveSessionSnapshot | null {
    return this.lastTerminal?.snapshot ?? null;
  }

  /** HTTP snapshot for restore-on-load, scoped to the requester's ownership. */
  public getSnapshotFor(userId: string | null, runId: string | undefined): ActiveSessionSnapshot | null {
    const run = this.run;
    if (run) {
      return this.isOwner(run, runId, userId) ? this.buildSnapshot(run) : null;
    }
    // No live run: offer the retained final state to its owner, under the same rule.
    const terminal = this.lastTerminal;
    if (!terminal) return null;
    const owner = { runToken: terminal.snapshot.runToken, userId: terminal.userId };
    return ownsRun(owner, runId, userId) ? terminal.snapshot : null;
  }

  private buildSnapshot(run: ActiveRun): ActiveSessionSnapshot {
    const elapsed = run.engine.getElapsedActiveTimeMs?.() ?? Math.max(0, Date.now() - run.startedAt);
    return {
      runId: run.runCode,
      runToken: run.runToken,
      ownerType: run.ownerType,
      targetUrl: run.targetUrl,
      currentUrl: run.currentUrl,
      status: run.status,
      terminationOutcome: run.terminationOutcome,
      terminationReason: run.terminationReason,
      startedAt: new Date(run.startedAt).toISOString(),
      elapsedTimeMs: elapsed,
      timeboxMs: run.timeboxMs,
      telemetry: [...run.telemetry],
      reports: [...run.reports],
      incidents: [...run.incidents],
      accessibility: [...run.accessibility],
      browserConsole: [...run.browserConsole],
      lastFrame: run.lastFrame,
      sessionId: run.sessionId ?? run.engine.getLastSessionId?.() ?? null,
    };
  }

  // ── Disconnect grace window ────────────────────────────────────────────────

  /** A socket dropped: start the grace teardown only if it was the last owner. */
  public handleDisconnect(socketId: string): void {
    const run = this.run;
    if (!run || !run.ownerSocketIds.has(socketId)) return;
    run.ownerSocketIds.delete(socketId);

    if (run.ownerSocketIds.size > 0) return; // another tab/socket still attached

    // Autonomous default: a disconnect never touches the engine. Leave status at its
    // live value so a reconnecting client and the persisted status both stay truthful;
    // the timebox / MAX_PAUSE_MS remain the sole terminators.
    if (!TERMINATE_ON_ABANDON) {
      this.emitMilestone('Operator disconnected — run continues autonomously.');
      obsLog.info(`[SessionManager] Run ${run.runToken} lost its last client; continuing (terminate-on-abandon off).`);
      return;
    }

    // STARTING included: an operator who closes the tab mid-boot must not leave a
    // browser launching into nothing once the engine finally comes up.
    if (run.status !== 'RUNNING' && run.status !== 'PAUSED' && run.status !== 'STARTING') return;

    run.status = 'INTERRUPTED';
    void this.persistStatus('INTERRUPTED');
    this.emitMilestone(`️ Operator disconnected — keeping session alive for ${Math.round(GRACE_MS / 1000)}s to allow reconnect.`);
    obsLog.info(`[SessionManager] Run ${run.runToken} INTERRUPTED; grace timer armed (${GRACE_MS}ms).`);

    run.graceTimer = setTimeout(() => {
      const active = this.run;
      if (!active || active.runToken !== run.runToken) return;
      active.status = 'DISCONNECTED';
      void this.persistStatus('DISCONNECTED');
      obsLog.info(`[SessionManager] Run ${active.runToken} grace expired — terminating engine.`);
      // Engine.stop() unwinds run() whose finally calls endRun(); nothing else to do.
      void Promise.resolve(active.engine.stop?.('disconnect-grace')).catch((err) =>
        obsLog.error('[SessionManager] Grace-expiry stop failed:', err),
      );
    }, GRACE_MS);
  }

  // ── Operator controls (routed from socket handlers) ─────────────────────────

  // Graceful pause: enter PAUSING, halt the engine, await in-flight tasks so their
  // telemetry is delivered, then settle to PAUSED. Transitional state is broadcast
  // via engine-pausing/engine-paused so the dashboard can show "Pausing…".
  public async pauseByOperator(): Promise<void> {
    const run = this.run;
    if (!run || typeof run.engine.pause !== 'function') return;
    // Idempotent against duplicate events and re-entry while a pause is settling.
    if (run.manualPaused || run.status === 'PAUSING' || run.status === 'STOPPING') return;
    run.manualPaused = true;
    run.pendingResume = false;
    run.status = 'PAUSING';
    run.engine.pause();
    this.emitEngineAction('engine-pausing', 'Pausing Safari — waiting for in-flight tasks to settle…');
    await Promise.resolve(run.engine.settlePendingTasks?.());
    // A stop that raced in during settlement wins — don't downgrade it to PAUSED.
    if (this.run !== run || (run.status as RunLifecycleStatus) === 'STOPPING') return;
    // A resume that arrived while settling was latched (not lost); honour it now
    // instead of finalizing to PAUSED, so rapid pause→resume ends up RUNNING.
    if (run.pendingResume && typeof run.engine.resume === 'function') {
      run.pendingResume = false;
      run.manualPaused = false;
      run.status = 'RUNNING';
      this.clearPauseDeadline(run);
      run.engine.resume();
      this.emitEngineAction('engine-resumed', 'Safari session resumed by user.');
      return;
    }
    run.status = 'PAUSED';
    this.armPauseDeadline(run);
    void this.persistStatus('PAUSED');
    this.emitEngineAction('engine-paused', 'Safari session paused by user.');
  }

  public resumeByOperator(): void {
    const run = this.run;
    if (!run || typeof run.engine.resume !== 'function') return;
    if (!run.manualPaused) return; // already resumed — idempotent no-op against duplicate events
    if (run.status === 'STOPPING') return; // a stop in progress wins
    // Pause still settling: latch the resume so pauseByOperator replays it on settle
    // rather than dropping it (the lost-command bug under rapid pause→resume).
    if (run.status === 'PAUSING') {
      run.pendingResume = true;
      return;
    }
    run.manualPaused = false;
    run.status = 'RUNNING';
    this.clearPauseDeadline(run);
    run.engine.resume();
    this.emitEngineAction('engine-resumed', 'Safari session resumed by user.');
  }

  // Graceful stop: enter STOPPING and broadcast engine-stopping so the dashboard
  // shows "Stopping…". engine.stop() flushes pending writes before releasing the
  // browser; the run's own finally emits IDLE and invokes endRun() to settle state.
  public async stopByOperator(reason: StopReason = 'operator'): Promise<void> {
    const run = this.run;
    if (!run || typeof run.engine.stop !== 'function') return;
    if (run.status === 'STOPPING') return; // idempotent against duplicate stop clicks
    this.clearPauseDeadline(run); // a stop supersedes any pending pause deadline
    // Booting: there is no engine to stop yet. Stay STARTING and record the intent
    // (with its reason) so beginRun applies it the instant the engine attaches —
    // changing status here would strand the run outside the reservation-upgrade path.
    if (run.status === 'STARTING') {
      run.pendingStop = true;
      run.pendingStopReason = reason;
      this.emitEngineAction('engine-stopping', 'Stop requested during startup — Safari will terminate as soon as the engine comes up.');
      return;
    }
    run.status = 'STOPPING';
    this.emitEngineAction('engine-stopping', 'Stopping Safari — flushing telemetry and pending writes…');
    // Arm the backstop BEFORE dispatching: a hung engine.stop() must not pin the slot.
    this.armStopWatchdog(run, reason);
    // Race the graceful stop against the deadline so this call never blocks longer
    // than STOP_TIMEOUT_MS even if engine.stop() hangs — the watchdog then force-
    // releases. On a clean stop, run()'s finally calls endRun() (clearing the
    // watchdog) and status settles to IDLE there. The deadline timer is always
    // cleared, so a fast stop leaves nothing pending on the event loop.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => { deadlineTimer = setTimeout(resolve, STOP_TIMEOUT_MS); });
    try {
      await Promise.race([Promise.resolve(run.engine.stop(reason)), deadline]);
    } catch (error) {
      obsLog.error('[SessionManager] engine.stop threw during operator stop:', error instanceof Error ? error.message : error);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  }

  // Force-release the run if a dispatched stop hasn't settled in time. Fires once;
  // teardownRun clears the timer on a clean stop so this never runs for a good stop.
  private armStopWatchdog(run: ActiveRun, reason: StopReason): void {
    if (run.stopWatchdogTimer) clearTimeout(run.stopWatchdogTimer);
    run.stopWatchdogTimer = setTimeout(() => {
      if (this.run !== run) return; // already torn down cleanly
      this.forceRelease(
        `Session stop did not settle within ${Math.round(STOP_TIMEOUT_MS / 1000)}s (reason=${reason}) — the run was force-terminated and all resources released.`,
        run.runToken,
      );
    }, STOP_TIMEOUT_MS);
    run.stopWatchdogTimer.unref();
  }

  /**
   * Hard release when a graceful stop cannot settle — a hung engine.stop(), a run()
   * that never unwinds, or an abandoned session torn down on logout. Emits the
   * terminal IDLE handshake the stuck run() will never emit itself, settles the
   * lifecycle (flushing telemetry + persisting status via endRun/teardownRun), and
   * frees the in-process admission slot so a new run can start immediately.
   */
  public forceRelease(message: string, runToken?: string): void {
    if (!this.run || this.isStaleSettle(runToken, 'forceRelease')) return;
    obsLog.error(`[SessionManager] Force-releasing run ${this.run.runToken}: ${message}`);
    this.emitFailure(message);
    this.endRun('CRASHED', runToken);
    this.onRelease?.();
  }

  /** RunId of the active run, or null. Used to scope cross-process controls. */
  public getActiveRunId(): string | null {
    return this.run?.runToken ?? null;
  }

  // Apply an operator control bridged from the API process, scoped to runId.
  // Ignored if this process holds no matching run (another worker owns it).
  public applyOperatorControl(command: OperatorCommand, runId: string | null, reason?: StopReason): void {
    const run = this.run;
    // Worker boot window: the run is enqueued/claimed but its engine has not called
    // beginRun yet, so there is nothing to control. A pause/resume is moot then (the
    // engine will start unpaused), but a stop MUST survive — drop it and the run
    // explores its whole timebox, pinning the worker slot. Remember it for beginRun.
    if (!run) {
      if (command === 'stop' && runId) this.rememberPendingStop(runId, reason ?? 'operator');
      return;
    }
    if (runId !== null && runId !== run.runToken) return;
    if (command === 'pause') void this.pauseByOperator();
    else if (command === 'resume') this.resumeByOperator();
    else void this.stopByOperator(reason ?? 'operator');
  }

  // ── Target health handler (crash escalation only) ───────────────────────────

  // Transient target outage: pause exploration and quarantine findings so a dead
  // network can't manufacture false bugs. Idempotent; probing continues so recovery
  // (onTargetRecovered) or a full crash (onTargetCrash) is still detected.
  private onTargetDegraded(failures: number): void {
    const run = this.run;
    if (!run || run.crashTerminated || run.networkPaused) return;
    run.networkPaused = true;
    NetworkQuarantine.beginDegraded(`target unreachable after ${failures} probes`);
    // Halt the loop only if the engine supports it and the operator hasn't paused.
    // The MAX_PAUSE deadline backstops a target that never recovers.
    if (!run.manualPaused && run.status === 'RUNNING' && typeof run.engine.pause === 'function') {
      run.engine.pause();
      this.armPauseDeadline(run);
    }
    this.emitEngineAction(NETWORK_ACTION.PAUSED, `Target ${run.targetUrl} unreachable — pausing exploration and retrying. Findings are suppressed until it recovers.`);
    obsLog.info(`[SessionManager] Run ${run.runToken} network-paused after ${failures} failed probes.`);
  }

  // Target reachable again after a transient outage — lift the quarantine and resume.
  private onTargetRecovered(): void {
    const run = this.run;
    if (!run || !run.networkPaused) return;
    run.networkPaused = false;
    NetworkQuarantine.endDegraded();
    if (!run.manualPaused && run.status === 'RUNNING' && typeof run.engine.resume === 'function') {
      run.engine.resume();
      this.clearPauseDeadline(run);
    }
    this.emitEngineAction(NETWORK_ACTION.RESUMED, `Target ${run.targetUrl} reachable again — resuming exploration.`);
    obsLog.info(`[SessionManager] Run ${run.runToken} network-resumed after target recovery.`);
  }

  /**
   * Target confirmed dead after `failures` consecutive verification probes — a
   * Critical Server Crash, not a transient navigation blip. Capture the last
   * actions into a forensic report, mark the run CRASH_COMPLETED, then gracefully
   * stop the engine (whose unwind releases every resource via endRun/teardownRun).
   */
  private async onTargetCrash(failures: number): Promise<void> {
    const run = this.run;
    if (!run || run.crashTerminated) return; // idempotent — fire once per run
    run.crashTerminated = true;

    const timestamp = new Date().toISOString();
    const reason = `Critical Server Crash: target ${run.targetUrl} unreachable after ${failures} verification probes.`;

    // Snapshot the rolling buffer as technical breadcrumbs, and derive the human
    // playbook from the CAUSALLY-MINIMIZED timeline (drop BugSafari's wandering,
    // anchor to the faulting page) rather than dumping the whole raw buffer.
    const lastActions = ReproductionPlaybookStore.snapshot();
    const reproduction = ActiveScenarioTracker.flushSnapshot({
      faultUrl: run.currentUrl || run.targetUrl,
      faultAtMs: Date.now(),
    });
    const crashReport: ForensicCrashReport = {
      timestamp,
      reason,
      url: run.currentUrl || run.targetUrl,
      breadcrumbs: lastActions.map((a) => ({
        timestamp: a.timestamp,
        selector: a.selector,
        action: a.type,
        payload: a.payload,
      })),
      reproductionPlaybook: reproduction.narrative,
      advice: 'Backend/main document stopped responding. Check server logs, process health, and container status for a crash or OOM at the timestamp above.',
    };

    // Persist status first so a mid-teardown reconnect already sees the crash.
    run.status = 'CRASH_COMPLETED';
    void this.persistStatus('CRASH_COMPLETED');

    // Broadcast + buffer the forensic report and a terminal milestone for the dashboard.
    this.gateway?.emitForensicReport(crashReport);
    this.emitMilestone(` ${reason} Saving forensic report and terminating session.`);

    // Graceful termination: stop() unwinds the engine's run() whose finally calls
    // endRun() → teardownRun(), releasing the health monitor, grace timer, room,
    // and replay buffer. crashTerminated pins the terminal status through that path.
    try {
      await Promise.resolve(run.engine.stop?.('target-crash'));
    } catch (err) {
      obsLog.error('[SessionManager] Crash-termination stop failed:', err);
      // Engine unresponsive — force teardown so resources are still released. Scoped
      // to THIS run: the await above can outlive it, and the operator may already
      // have launched the next one.
      this.endRun('CRASH_COMPLETED', run.runToken);
    }
  }

  // ── Emit helpers (all room-scoped via the gateway/io) ───────────────────────

  private emitEngineAction(actionExecuted: string, message: string): void {
    // Route through the gateway so it's buffered for replay AND room-scoped.
    this.gateway?.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: { actionExecuted, message },
    });
  }

  private emitMilestone(message: string): void {
    this.gateway?.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: { actionExecuted: 'system-milestone', message },
    });
  }

  /** Push the current snapshot to a specific socket (used on server-driven replay). */
  public pushSnapshot(socket: Socket): void {
    const run = this.run;
    if (!run) return;
    socket.emit(SESSION_SNAPSHOT_EVENT, this.buildSnapshot(run));
  }

  // ── DB status persistence (authenticated runs only) ─────────────────────────

  private async persistStatus(status: RunLifecycleStatus): Promise<void> {
    const run = this.run;
    if (!run || !run.userId || !isValidObjectId(run.userId)) return;

    const dbSessionId = run.engine.getLastSessionId?.() ?? null;
    if (!dbSessionId || !isValidObjectId(dbSessionId)) return;

    const dbStatus = LIFECYCLE_TO_DB_STATUS[status];
    if (!dbStatus) return;

    try {
      await SessionModel.updateOne(
        { _id: new Types.ObjectId(dbSessionId), userId: new Types.ObjectId(run.userId) },
        { $set: { status: dbStatus } },
      );
    } catch (error) {
      obsLog.error('[SessionManager] Failed to persist run status:', error);
    }
  }
}

// Map the live lifecycle onto the persisted DB enum. COMPLETED/CRASHED are left
// to the engine's own completeSession() so we don't double-write terminal states.
const LIFECYCLE_TO_DB_STATUS: Partial<Record<RunLifecycleStatus, SessionStatus>> = {
  RUNNING: SessionStatus.RUNNING,
  PAUSED: SessionStatus.PAUSED,
  INTERRUPTED: SessionStatus.INTERRUPTED,
  DISCONNECTED: SessionStatus.DISCONNECTED,
  // Server-crash termination is detected out-of-band (the paused engine never
  // reaches its own completeSession), so the manager persists the terminal state.
  CRASH_COMPLETED: SessionStatus.CRASHED,
};

// A guest has no persistent identity, so its tenant key is derived from the
// unguessable server-issued run token — unique per run, never null.
export function guestOwnerKey(userId: string | null, runId: string): string {
  return userId ?? `guest:${runId}`;
}

function pushCapped<T>(buffer: T[], item: T, cap: number): void {
  buffer.push(item);
  while (buffer.length > cap) buffer.shift();
}

// Process-wide singleton — one active run, matching the admission model.
export const sessionManager = new SessionManager();

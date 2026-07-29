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
import { SESSION_SNAPSHOT_EVENT } from '../../../../shared/types.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { SocketTelemetryGateway, TelemetryRecordKind, TelemetryRecorder } from '../../infrastructure/socket/SocketTelemetryGateway.js';
import { TargetHealthMonitor } from './TargetHealthMonitor.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import type { OperatorCommand } from '../../infrastructure/queue/controlBridge.js';

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
const HEALTH_INTERVAL_MS = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_INTERVAL_MS, 15_000);
const HEALTH_TIMEOUT_MS = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_TIMEOUT_MS, 5_000);
// Consecutive failed probes before declaring a Critical Server Crash and terminating.
const HEALTH_CRASH_THRESHOLD = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_CRASH_THRESHOLD, 3);
// The health probe runs in the Node process, whose in-container network view can
// differ from the Playwright browser's (proxy settings, DNS resolution, and
// egress rules are not necessarily shared). A Node probe that can't reach a target the browser CAN
// would falsely crash the run, so the kill-switch is OFF by default — genuine
// server failures are still caught browser-side (5xx / requestfailed / pageerror).
// Enable only where the engine process and the browser share the target's network.
const HEALTH_MONITOR_ENABLED = process.env.BUGSAFARI_TARGET_HEALTH_MONITOR?.trim().toLowerCase() === 'on';
// How long a reserved room may wait for its engine to call beginRun before the
// run is declared stillborn. Must exceed a cold Playwright launch (30s race in
// PlaywrightBrowserEngine) with headroom for the pre-launch imports.
const RESERVATION_TIMEOUT_MS = readPositiveInt(process.env.BUGSAFARI_RESERVATION_TIMEOUT_MS, 45_000);
const TELEMETRY_BUFFER_CAP = 500;
const REPORT_BUFFER_CAP = 100;
const CONSOLE_BUFFER_CAP = 200;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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
  crashTerminated: boolean; // target server crash confirmed; run being torn down
  // Why the run ended, captured off the terminal telemetry event. Held on the run
  // (not derived from the capped replay buffer) so a restore is always accurate.
  terminationOutcome: RunTerminationOutcome | null;
  terminationReason: string | null;
  health: TargetHealthMonitor;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // Armed while STARTING; disarmed by beginRun. Expiry declares the run stillborn.
  reservationTimer: ReturnType<typeof setTimeout> | null;
  // A stop issued while STARTING has no engine to reach — remembered so beginRun
  // honours it the moment the real engine attaches (no zombie run).
  pendingStop: boolean;
  // The reason carried by that deferred stop, replayed with it so a timebox/shutdown
  // stop during boot is not silently re-attributed to the operator.
  pendingStopReason: StopReason;
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
  // Final snapshot of the most recently ended run, kept until the next run
  // begins so a refresh restores the completed/stopped state instead of IDLE.
  private lastTerminal: { snapshot: ActiveSessionSnapshot; userId: string | null } | null = null;

  /** Wire the manager to the shared telemetry gateway (room-scoped emitter). */
  public initialize(gateway: SocketTelemetryGateway): void {
    this.gateway = gateway;
  }

  public get graceMs(): number {
    return GRACE_MS;
  }

  public hasActiveRun(): boolean {
    return this.run !== null;
  }

  /** Engine control surface of the active run (used by the HTTP stop endpoint). */
  public getActiveEngine(): EngineControl | null {
    return this.run?.engine ?? null;
  }

  public getActiveUserId(): string | null {
    return this.run?.userId ?? null;
  }

  /** Unique tenant key of the active run (guests included), or null. */
  public getActiveOwnerKey(): string | null {
    return this.run?.ownerKey ?? null;
  }

  /** Public ownership probe for HTTP callers (stop endpoint). */
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
      console.error(`[SessionManager] Run ${run.runToken} never started within ${RESERVATION_TIMEOUT_MS}ms — declaring it stillborn.`);
      this.emitFailure(`Engine failed to start within ${Math.round(RESERVATION_TIMEOUT_MS / 1000)}s. The session was cancelled and all resources released.`);
      this.endRun('CRASHED');
      params.onAbandoned?.();
    }, RESERVATION_TIMEOUT_MS);

    this.gateway?.setRoom(this.run.room);
    this.gateway?.setRecorder(this);
    console.log(`[SessionManager] Run ${params.runToken} reserved (room ready, awaiting engine).`);
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
      console.log(`[SessionManager] Run ${params.runToken} started from reservation (${reserved.ownerType}, target=${params.targetUrl}).`);
      // Honour a stop the operator issued while the engine was still booting.
      if (reserved.pendingStop) {
        reserved.pendingStop = false;
        console.log(`[SessionManager] Run ${params.runToken} had a stop pending from boot — applying now.`);
        void this.stopByOperator(reserved.pendingStopReason);
      }
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
    console.log(`[SessionManager] Run ${params.runToken} started (${this.run.ownerType}, target=${params.targetUrl}, grace=${GRACE_MS}ms, healthMonitor=${HEALTH_MONITOR_ENABLED ? 'on' : 'off'})`);
  }

  private createRun(params: BeginRunParams, status: RunLifecycleStatus): ActiveRun {
    const room = `run:${params.runToken}`;
    const health = new TargetHealthMonitor(params.targetUrl, HEALTH_INTERVAL_MS, HEALTH_TIMEOUT_MS, {
      onCrash: (failures) => void this.onTargetCrash(failures),
    }, HEALTH_CRASH_THRESHOLD);

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
      crashTerminated: false,
      terminationOutcome: null,
      terminationReason: null,
      health,
      graceTimer: null,
      reservationTimer: null,
      pendingStop: false,
      pendingStopReason: 'operator',
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

  /** Publish a terminal failure for the active run and release it. */
  public failRun(message: string): void {
    if (!this.run) return;
    this.emitFailure(message);
    this.endRun('CRASHED');
  }

  /** Called from the run's finally block when the engine loop returns/throws. */
  public endRun(finalStatus: RunLifecycleStatus = 'COMPLETED'): void {
    if (!this.run) return;
    const { runToken } = this.run;
    // A confirmed server crash is terminal — the normal run-completion path must
    // not downgrade it back to COMPLETED when the stopped engine unwinds.
    const status: RunLifecycleStatus = this.run.crashTerminated ? 'CRASH_COMPLETED' : finalStatus;
    this.run.status = status;
    void this.persistStatus(status);
    // Retain the final state so a post-completion refresh can restore it.
    this.lastTerminal = { snapshot: this.buildSnapshot(this.run), userId: this.run.userId };
    this.teardownRun();
    console.log(`[SessionManager] Run ${runToken} ended (${status})`);
  }

  private teardownRun(): void {
    if (!this.run) return;
    this.run.health.stop();
    if (this.run.graceTimer) {
      clearTimeout(this.run.graceTimer);
      this.run.graceTimer = null;
    }
    if (this.run.reservationTimer) {
      clearTimeout(this.run.reservationTimer);
      this.run.reservationTimer = null;
    }
    this.gateway?.setRoom(null);
    this.gateway?.setRecorder(null);
    this.run = null;
  }

  // ── TelemetryRecorder: buffer every outbound payload for reconnect replay ──

  public record(kind: TelemetryRecordKind, payload: unknown): void {
    const run = this.run;
    if (!run) return;

    switch (kind) {
      case 'telemetry':
        pushCapped(run.telemetry, payload as TelemetryEvent, TELEMETRY_BUFFER_CAP);
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

  // Pin the termination the moment the engine declares one, so the reason survives
  // independently of the capped telemetry buffer that carried it. First one wins —
  // a later teardown event must not overwrite the real cause.
  private observeTerminationFrom(event: TelemetryEvent): void {
    const run = this.run;
    if (!run || run.terminationOutcome || !event.meta?.terminationOutcome) return;
    run.terminationOutcome = event.meta.terminationOutcome;
    run.terminationReason = event.meta.message ?? null;
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
   * Ownership check. Possession of the server-issued run token is proof of
   * ownership for BOTH guests and authenticated operators — the token is a UUID
   * returned only in the authenticated start-test response, never broadcast. This
   * is the primary path because the Socket.IO handshake carries no JWT, so a
   * socket's userId is null even for an authenticated run; requiring identity
   * here would reject every socket attach and starve the client of live frames.
   * Identity match is an additional accepted path for the HTTP restore endpoint,
   * whose request DOES carry the Bearer token.
   */
  private isOwner(run: ActiveRun, runId: string | undefined, userId: string | null): boolean {
    if (typeof runId === 'string' && runId === run.runToken) return true;
    return run.userId !== null && userId !== null && userId === run.userId;
  }

  /** Unscoped snapshot of the active run — worker-side Redis publishing only. */
  public getActiveSnapshot(): ActiveSessionSnapshot | null {
    return this.run ? this.buildSnapshot(this.run) : null;
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
    // No live run: offer the retained final state to its owner (token or identity).
    const terminal = this.lastTerminal;
    if (!terminal) return null;
    const ownsByToken = typeof runId === 'string' && runId === terminal.snapshot.runToken;
    const ownsByIdentity = terminal.userId !== null && userId !== null && userId === terminal.userId;
    return ownsByToken || ownsByIdentity ? terminal.snapshot : null;
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
    };
  }

  // ── Disconnect grace window ────────────────────────────────────────────────

  /** A socket dropped: start the grace teardown only if it was the last owner. */
  public handleDisconnect(socketId: string): void {
    const run = this.run;
    if (!run || !run.ownerSocketIds.has(socketId)) return;
    run.ownerSocketIds.delete(socketId);

    if (run.ownerSocketIds.size > 0) return; // another tab/socket still attached
    // STARTING included: an operator who closes the tab mid-boot must not leave a
    // browser launching into nothing once the engine finally comes up.
    if (run.status !== 'RUNNING' && run.status !== 'PAUSED' && run.status !== 'STARTING') return;

    run.status = 'INTERRUPTED';
    void this.persistStatus('INTERRUPTED');
    this.emitMilestone(`️ Operator disconnected — keeping session alive for ${Math.round(GRACE_MS / 1000)}s to allow reconnect.`);
    console.log(`[SessionManager] Run ${run.runToken} INTERRUPTED; grace timer armed (${GRACE_MS}ms).`);

    run.graceTimer = setTimeout(() => {
      const active = this.run;
      if (!active || active.runToken !== run.runToken) return;
      active.status = 'DISCONNECTED';
      void this.persistStatus('DISCONNECTED');
      console.log(`[SessionManager] Run ${active.runToken} grace expired — terminating engine.`);
      // Engine.stop() unwinds run() whose finally calls endRun(); nothing else to do.
      void Promise.resolve(active.engine.stop?.('disconnect-grace')).catch((err) =>
        console.error('[SessionManager] Grace-expiry stop failed:', err),
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
    run.status = 'PAUSING';
    run.engine.pause();
    this.emitEngineAction('engine-pausing', 'Pausing Safari — waiting for in-flight tasks to settle…');
    await Promise.resolve(run.engine.settlePendingTasks?.());
    // A stop that raced in during settlement wins — don't downgrade it to PAUSED.
    if (this.run !== run || (run.status as RunLifecycleStatus) === 'STOPPING') return;
    run.status = 'PAUSED';
    void this.persistStatus('PAUSED');
    this.emitEngineAction('engine-paused', 'Safari session paused by user.');
  }

  public resumeByOperator(): void {
    const run = this.run;
    if (!run || typeof run.engine.resume !== 'function') return;
    if (!run.manualPaused) return; // already resumed — idempotent no-op against duplicate events
    if (run.status === 'PAUSING' || run.status === 'STOPPING') return; // let the transition settle first
    run.manualPaused = false;
    run.status = 'RUNNING';
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
    await Promise.resolve(run.engine.stop(reason));
    // endRun() is invoked by the run's own finally block; status settles to IDLE there.
  }

  /** RunId of the active run, or null. Used to scope cross-process controls. */
  public getActiveRunId(): string | null {
    return this.run?.runToken ?? null;
  }

  // Apply an operator control bridged from the API process, scoped to runId.
  // Ignored if this process holds no matching run (another worker owns it).
  public applyOperatorControl(command: OperatorCommand, runId: string | null, reason?: StopReason): void {
    const run = this.run;
    if (!run || (runId !== null && runId !== run.runToken)) return;
    if (command === 'pause') void this.pauseByOperator();
    else if (command === 'resume') this.resumeByOperator();
    else void this.stopByOperator(reason ?? 'operator');
  }

  // ── Target health handler (crash escalation only) ───────────────────────────

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
      console.error('[SessionManager] Crash-termination stop failed:', err);
      // Engine unresponsive — force teardown so resources are still released.
      this.endRun('CRASH_COMPLETED');
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
      console.error('[SessionManager] Failed to persist run status:', error);
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

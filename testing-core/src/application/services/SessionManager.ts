import type { Socket } from 'socket.io';
import { Types, isValidObjectId } from 'mongoose';
import type {
  AccessibilityFinding,
  ActiveSessionSnapshot,
  ForensicCrashReport,
  IncidentReport,
  RunLifecycleStatus,
  SessionAttachAck,
  SessionOwnerType,
  TelemetryEvent,
} from '../../../../shared/types.js';
import { SESSION_SNAPSHOT_EVENT } from '../../../../shared/types.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { SocketTelemetryGateway, TelemetryRecordKind, TelemetryRecorder } from '../../infrastructure/socket/SocketTelemetryGateway.js';
import { TargetHealthMonitor } from './TargetHealthMonitor.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import type { OperatorCommand } from '../../infrastructure/queue/controlBridge.js';

/** Minimal control surface the manager needs from the live browser engine. */
export interface EngineControl {
  pause?: () => void;
  resume?: () => void;
  stop?: () => Promise<void> | void;
  getElapsedActiveTimeMs?: () => number;
  getLastSessionId?: () => string | null;
}

export interface BeginRunParams {
  runId: string;
  userId: string | null;        // authenticated owner id, or null for a guest run
  targetUrl: string;
  timeboxMs: number;
  engine: EngineControl;
}

// Env-tunable knobs (all optional; safe defaults).
const GRACE_MS = readPositiveInt(process.env.BUGSAFARI_SESSION_GRACE_MS, 60_000);
const HEALTH_INTERVAL_MS = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_INTERVAL_MS, 15_000);
const HEALTH_TIMEOUT_MS = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_TIMEOUT_MS, 5_000);
// Consecutive failed probes before declaring a Critical Server Crash and terminating.
const HEALTH_CRASH_THRESHOLD = readPositiveInt(process.env.BUGSAFARI_TARGET_HEALTH_CRASH_THRESHOLD, 3);
// The health probe runs in the Node process, whose in-container network view can
// differ from the Playwright browser's (loopback targets are bridged to
// host.docker.internal for the BROWSER; Podman serves host.containers.internal;
// DNS/binding differ). A Node probe that can't reach a target the browser CAN
// would falsely crash the run, so the kill-switch is OFF by default — genuine
// server failures are still caught browser-side (5xx / requestfailed / pageerror).
// Enable only where the engine process and the browser share the target's network.
const HEALTH_MONITOR_ENABLED = process.env.BUGSAFARI_TARGET_HEALTH_MONITOR?.trim().toLowerCase() === 'on';
const TELEMETRY_BUFFER_CAP = 500;
const REPORT_BUFFER_CAP = 100;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

interface ActiveRun {
  runId: string;
  userId: string | null;
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
  health: TargetHealthMonitor;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // Replay ring buffers (bounded).
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  accessibility: AccessibilityFinding[];
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

  // ── Run lifecycle ────────────────────────────────────────────────────────

  public beginRun(params: BeginRunParams): void {
    // Defensive: never leak a previous run's timers/monitors if begin is called
    // without a matching end (shouldn't happen under the 429 admission guard).
    if (this.run) {
      this.teardownRun();
    }

    const room = `run:${params.runId}`;
    const health = new TargetHealthMonitor(params.targetUrl, HEALTH_INTERVAL_MS, HEALTH_TIMEOUT_MS, {
      onCrash: (failures) => void this.onTargetCrash(failures),
    }, HEALTH_CRASH_THRESHOLD);

    this.run = {
      runId: params.runId,
      userId: params.userId,
      ownerType: params.userId ? 'authenticated' : 'guest',
      targetUrl: params.targetUrl,
      currentUrl: params.targetUrl,
      timeboxMs: params.timeboxMs,
      startedAt: Date.now(),
      engine: params.engine,
      status: 'RUNNING',
      room,
      ownerSocketIds: new Set<string>(),
      manualPaused: false,
      crashTerminated: false,
      health,
      graceTimer: null,
      telemetry: [],
      reports: [],
      incidents: [],
      accessibility: [],
      lastFrame: null,
    };

    // Scope the wire to this run's room and start buffering for replay.
    this.gateway?.setRoom(room);
    this.gateway?.setRecorder(this);
    // Only arm the out-of-browser reachability kill-switch when explicitly enabled
    // (see HEALTH_MONITOR_ENABLED) — otherwise a container network mismatch could
    // crash a perfectly healthy run.
    if (HEALTH_MONITOR_ENABLED) health.start();
    console.log(`[SessionManager] Run ${params.runId} started (${this.run.ownerType}, target=${params.targetUrl}, grace=${GRACE_MS}ms, healthMonitor=${HEALTH_MONITOR_ENABLED ? 'on' : 'off'})`);
  }

  /** Called from the run's finally block when the engine loop returns/throws. */
  public endRun(finalStatus: RunLifecycleStatus = 'COMPLETED'): void {
    if (!this.run) return;
    const { runId } = this.run;
    // A confirmed server crash is terminal — the normal run-completion path must
    // not downgrade it back to COMPLETED when the stopped engine unwinds.
    const status: RunLifecycleStatus = this.run.crashTerminated ? 'CRASH_COMPLETED' : finalStatus;
    this.run.status = status;
    void this.persistStatus(status);
    this.teardownRun();
    console.log(`[SessionManager] Run ${runId} ended (${status})`);
  }

  private teardownRun(): void {
    if (!this.run) return;
    this.run.health.stop();
    if (this.run.graceTimer) {
      clearTimeout(this.run.graceTimer);
      this.run.graceTimer = null;
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
    }
  }

  // Track PAUSED↔RUNNING from the engine's own pause/resume telemetry so a
  // reattaching client sees the true state even after an operator pause.
  private observeStatusFrom(event: TelemetryEvent): void {
    const run = this.run;
    if (!run || run.crashTerminated || event.type !== 'ACTION') return; // crash is terminal
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
      this.emitMilestone(`🔌 Operator reconnected — session restored (${run.status.toLowerCase()}).`);
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
    if (typeof runId === 'string' && runId === run.runId) return true;
    return run.userId !== null && userId !== null && userId === run.userId;
  }

  /** HTTP snapshot for restore-on-load, scoped to the requester's ownership. */
  public getSnapshotFor(userId: string | null, runId: string | undefined): ActiveSessionSnapshot | null {
    const run = this.run;
    if (!run || !this.isOwner(run, runId, userId)) return null;
    return this.buildSnapshot(run);
  }

  private buildSnapshot(run: ActiveRun): ActiveSessionSnapshot {
    const elapsed = run.engine.getElapsedActiveTimeMs?.() ?? Math.max(0, Date.now() - run.startedAt);
    return {
      runId: run.runId,
      ownerType: run.ownerType,
      targetUrl: run.targetUrl,
      currentUrl: run.currentUrl,
      status: run.status,
      startedAt: new Date(run.startedAt).toISOString(),
      elapsedTimeMs: elapsed,
      timeboxMs: run.timeboxMs,
      telemetry: [...run.telemetry],
      reports: [...run.reports],
      incidents: [...run.incidents],
      accessibility: [...run.accessibility],
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
    if (run.status !== 'RUNNING' && run.status !== 'PAUSED') return;

    run.status = 'INTERRUPTED';
    void this.persistStatus('INTERRUPTED');
    this.emitMilestone(`⚠️ Operator disconnected — keeping session alive for ${Math.round(GRACE_MS / 1000)}s to allow reconnect.`);
    console.log(`[SessionManager] Run ${run.runId} INTERRUPTED; grace timer armed (${GRACE_MS}ms).`);

    run.graceTimer = setTimeout(() => {
      const active = this.run;
      if (!active || active.runId !== run.runId) return;
      active.status = 'DISCONNECTED';
      void this.persistStatus('DISCONNECTED');
      console.log(`[SessionManager] Run ${active.runId} grace expired — terminating engine.`);
      // Engine.stop() unwinds run() whose finally calls endRun(); nothing else to do.
      void Promise.resolve(active.engine.stop?.()).catch((err) =>
        console.error('[SessionManager] Grace-expiry stop failed:', err),
      );
    }, GRACE_MS);
  }

  // ── Operator controls (routed from socket handlers) ─────────────────────────

  public pauseByOperator(): void {
    const run = this.run;
    if (!run || typeof run.engine.pause !== 'function') return;
    if (run.manualPaused) return; // already paused — idempotent no-op against duplicate events
    run.manualPaused = true;
    run.engine.pause();
    this.emitEngineAction('engine-paused', 'Safari session paused by user.');
  }

  public resumeByOperator(): void {
    const run = this.run;
    if (!run || typeof run.engine.resume !== 'function') return;
    if (!run.manualPaused) return; // already resumed — idempotent no-op against duplicate events
    run.manualPaused = false;
    run.engine.resume();
    this.emitEngineAction('engine-resumed', 'Safari session resumed by user.');
  }

  public async stopByOperator(): Promise<void> {
    const run = this.run;
    if (!run || typeof run.engine.stop !== 'function') return;
    await Promise.resolve(run.engine.stop());
    // endRun() is invoked by the run's own finally block; status settles there.
  }

  /** RunId of the active run, or null. Used to scope cross-process controls. */
  public getActiveRunId(): string | null {
    return this.run?.runId ?? null;
  }

  // Apply an operator control bridged from the API process, scoped to runId.
  // Ignored if this process holds no matching run (another worker owns it).
  public applyOperatorControl(command: OperatorCommand, runId: string | null): void {
    const run = this.run;
    if (!run || (runId !== null && runId !== run.runId)) return;
    if (command === 'pause') this.pauseByOperator();
    else if (command === 'resume') this.resumeByOperator();
    else void this.stopByOperator();
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

    // Snapshot the rolling 20-action buffer as breadcrumbs + narrative playbook so
    // the operator can reproduce whatever action preceded the outage.
    const lastActions = ReproductionPlaybookStore.snapshot();
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
      reproductionPlaybook: ReproductionPlaybookStore.getNarrativeSteps(),
      advice: 'Backend/main document stopped responding. Check server logs, process health, and container status for a crash or OOM at the timestamp above.',
    };

    // Persist status first so a mid-teardown reconnect already sees the crash.
    run.status = 'CRASH_COMPLETED';
    void this.persistStatus('CRASH_COMPLETED');

    // Broadcast + buffer the forensic report and a terminal milestone for the dashboard.
    this.gateway?.emitForensicReport(crashReport);
    this.emitMilestone(`🛑 ${reason} Saving forensic report and terminating session.`);

    // Graceful termination: stop() unwinds the engine's run() whose finally calls
    // endRun() → teardownRun(), releasing the health monitor, grace timer, room,
    // and replay buffer. crashTerminated pins the terminal status through that path.
    try {
      await Promise.resolve(run.engine.stop?.());
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

function pushCapped<T>(buffer: T[], item: T, cap: number): void {
  buffer.push(item);
  while (buffer.length > cap) buffer.shift();
}

// Process-wide singleton — one active run, matching the admission model.
export const sessionManager = new SessionManager();

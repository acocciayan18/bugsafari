import type { Server, Socket } from 'socket.io';
import { Types, isValidObjectId } from 'mongoose';
import type {
  ActiveSessionSnapshot,
  DecisionRationale,
  ForensicCrashReport,
  IncidentReport,
  NetworkAlert,
  RunLifecycleStatus,
  SessionAttachAck,
  SessionOwnerType,
  TelemetryEvent,
} from '../../../../shared/types.js';
import { NETWORK_ALERT_EVENT, SESSION_SNAPSHOT_EVENT } from '../../../../shared/types.js';
import { SessionStatus } from '../../infrastructure/database/models/FindingType.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import type { SocketTelemetryGateway, TelemetryRecordKind, TelemetryRecorder } from '../../infrastructure/socket/SocketTelemetryGateway.js';
import { TargetHealthMonitor } from './TargetHealthMonitor.js';

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
const TELEMETRY_BUFFER_CAP = 500;
const REPORT_BUFFER_CAP = 100;
const RATIONALE_BUFFER_CAP = 60;

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
  autoPaused: boolean;     // paused by the health monitor during a target outage
  targetHealthy: boolean;
  health: TargetHealthMonitor;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // Replay ring buffers (bounded).
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  rationales: DecisionRationale[];
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
  private io: Server | null = null;
  private gateway: SocketTelemetryGateway | null = null;
  private run: ActiveRun | null = null;

  /** Wire the manager to the live Socket.IO server + shared telemetry gateway. */
  public initialize(io: Server, gateway: SocketTelemetryGateway): void {
    this.io = io;
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
      onUnreachable: (attempt, nextRetryMs) => this.onTargetUnreachable(attempt, nextRetryMs),
      onRecovered: (failures) => this.onTargetRecovered(failures),
    });

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
      autoPaused: false,
      targetHealthy: true,
      health,
      graceTimer: null,
      telemetry: [],
      reports: [],
      incidents: [],
      rationales: [],
      lastFrame: null,
    };

    // Scope the wire to this run's room and start buffering for replay.
    this.gateway?.setRoom(room);
    this.gateway?.setRecorder(this);
    health.start();
    console.log(`[SessionManager] Run ${params.runId} started (${this.run.ownerType}, target=${params.targetUrl}, grace=${GRACE_MS}ms)`);
  }

  /** Called from the run's finally block when the engine loop returns/throws. */
  public endRun(finalStatus: RunLifecycleStatus = 'COMPLETED'): void {
    if (!this.run) return;
    const { runId } = this.run;
    this.run.status = finalStatus;
    void this.persistStatus(finalStatus);
    this.teardownRun();
    console.log(`[SessionManager] Run ${runId} ended (${finalStatus})`);
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
      case 'decision-rationale':
        pushCapped(run.rationales, payload as DecisionRationale, RATIONALE_BUFFER_CAP);
        break;
    }
  }

  // Track PAUSED↔RUNNING from the engine's own pause/resume telemetry so a
  // reattaching client sees the true state even after an operator pause.
  private observeStatusFrom(event: TelemetryEvent): void {
    const run = this.run;
    if (!run || event.type !== 'ACTION') return;
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
      targetHealthy: run.targetHealthy,
      telemetry: [...run.telemetry],
      reports: [...run.reports],
      incidents: [...run.incidents],
      rationales: [...run.rationales],
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
    run.manualPaused = true;
    run.engine.pause();
    this.emitEngineAction('engine-paused', 'Safari session paused by user.');
  }

  public resumeByOperator(): void {
    const run = this.run;
    if (!run || typeof run.engine.resume !== 'function') return;
    run.manualPaused = false;
    // Don't fight an active outage: if the target is still down, stay paused —
    // the health monitor will resume once it recovers.
    if (run.autoPaused) {
      this.emitMilestone('⏸️ Resume deferred — target still unreachable; will auto-resume on recovery.');
      return;
    }
    run.engine.resume();
    this.emitEngineAction('engine-resumed', 'Safari session resumed by user.');
  }

  public async stopByOperator(): Promise<void> {
    const run = this.run;
    if (!run || typeof run.engine.stop !== 'function') return;
    await Promise.resolve(run.engine.stop());
    // endRun() is invoked by the run's own finally block; status settles there.
  }

  // ── Target health handlers ──────────────────────────────────────────────────

  private onTargetUnreachable(attempt: number, nextRetryMs: number): void {
    const run = this.run;
    if (!run) return;
    run.targetHealthy = false;

    // Pause the engine on the first failure so the timebox doesn't burn during
    // an outage. Idempotent: only act on the transition into auto-paused.
    if (!run.autoPaused) {
      run.autoPaused = true;
      run.engine.pause?.();
    }

    const alert: NetworkAlert = {
      kind: 'target-unreachable',
      targetUrl: run.targetUrl,
      attempt,
      nextRetryMs,
      message: `Target ${run.targetUrl} unreachable (attempt ${attempt}). Execution paused; retrying every ${Math.round(nextRetryMs / 1000)}s.`,
      timestamp: new Date().toISOString(),
    };
    this.emitNetworkAlert(alert);
    // Also surface in the log stream for operators watching the terminal.
    this.emitEngineAction('target-unreachable', alert.message);
  }

  private onTargetRecovered(failures: number): void {
    const run = this.run;
    if (!run) return;
    run.targetHealthy = true;

    const wasAutoPaused = run.autoPaused;
    run.autoPaused = false;

    const alert: NetworkAlert = {
      kind: 'target-recovered',
      targetUrl: run.targetUrl,
      attempt: failures,
      message: `Target ${run.targetUrl} reachable again after ${failures} failed probe(s).`,
      timestamp: new Date().toISOString(),
    };
    this.emitNetworkAlert(alert);
    this.emitEngineAction('target-recovered', alert.message);

    // Auto-resume only if WE paused it and the operator hasn't since paused it.
    if (wasAutoPaused && !run.manualPaused) {
      run.engine.resume?.();
      this.emitEngineAction('engine-resumed', 'Target recovered — resuming exploration.');
    }
  }

  // ── Emit helpers (all room-scoped via the gateway/io) ───────────────────────

  private emitNetworkAlert(alert: NetworkAlert): void {
    this.roomEmit(NETWORK_ALERT_EVENT, alert);
  }

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

  private roomEmit(event: string, payload: unknown): void {
    const run = this.run;
    if (!this.io || !run) return;
    this.io.to(run.room).emit(event, payload);
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
};

function pushCapped<T>(buffer: T[], item: T, cap: number): void {
  buffer.push(item);
  while (buffer.length > cap) buffer.shift();
}

// Process-wide singleton — one active run, matching the admission model.
export const sessionManager = new SessionManager();

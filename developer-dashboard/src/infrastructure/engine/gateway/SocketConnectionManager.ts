import { io, type Socket } from 'socket.io-client';
import type { BrowserConsoleMessage } from '../../../application/ports/EngineGateway';
import type { AccessibilityFinding, ActiveSessionSnapshot, ForensicCrashReport, IncidentReport, QueueSubscribeRequest, QueueUpdate, ReproductionVerdict, SessionAttachAck, StopReason, TelemetryEvent, TimeSyncPayload } from '../../../types';
import { ACCESSIBILITY_EVENT, QUEUE_SUBSCRIBE_EVENT, QUEUE_UPDATE_EVENT, REPRODUCTION_VERDICT_EVENT, SESSION_ATTACH_EVENT, SESSION_SNAPSHOT_EVENT, TIME_SYNC_EVENT } from '../../../types';
import { logger } from '../../../utils/logger';
import { canAttach, storedAuthToken } from './attachEligibility';

type ConnectedHandler = (connected: boolean) => void;
type TelemetryHandler = (event: TelemetryEvent) => void;
type ForensicHandler = (report: ForensicCrashReport) => void;
type IncidentHandler = (report: IncidentReport) => void;
type ReproductionVerdictHandler = (verdict: ReproductionVerdict) => void;
type AccessibilityHandler = (finding: AccessibilityFinding) => void;
type FrameHandler = (base64Jpeg: string) => void;
type UrlChangedHandler = (url: string) => void;
type BrowserConsoleHandler = (message: BrowserConsoleMessage) => void;
type ReconnectingHandler = (attempt: number) => void;
type ReconnectFailedHandler = () => void;
type SessionSnapshotHandler = (snapshot: ActiveSessionSnapshot) => void;
type QueueUpdateHandler = (update: QueueUpdate) => void;
type TimeSyncHandler = (payload: TimeSyncPayload) => void;

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// Backoff for re-presenting the run token when the room isn't there yet.
const ATTACH_RETRY_DELAYS_MS = [250, 500, 1000, 2000];

// Reconnection budget + exponential-backoff bounds, env-tunable (VITE_*) with safe
// defaults. randomizationFactor jitters each delay so a fleet of dashboards dropped
// by one backend blip don't reconnect in lockstep and thunder the server.
function envInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
const RECONNECT = {
  attempts: envInt(import.meta.env?.VITE_SOCKET_RECONNECT_ATTEMPTS, 10),
  delayMs: envInt(import.meta.env?.VITE_SOCKET_RECONNECT_DELAY_MS, 1000),
  delayMaxMs: envInt(import.meta.env?.VITE_SOCKET_RECONNECT_DELAY_MAX_MS, 5000),
  jitter: 0.5,
};

/**
 * Socket.IO lifecycle + event binding/dispatch for the engine gateway. Owns the
 * socket, connection state, the bind/unbind blocks, every server→client handler,
 * the on* subscriber registration, and the frontend→backend control emits
 * (pause/resume/stop). Also drives reconnect re-attach: on every (re)connect it
 * presents the owned run token so the backend replays the live session.
 */
export class SocketConnectionManager {
  private readonly socket: Socket;

  // Connection state tracking
  private connectionStateValue: ConnectionState = 'disconnected';
  private connectionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly CONNECTION_TIMEOUT_MS = 10000; // 10 second timeout for initial connection

  // Run token of the active run this client owns — presented on every connect so
  // a refresh / transient drop re-attaches instead of losing the run.
  private runId: string | null = null;

  private connectedHandler: ConnectedHandler | null = null;
  private telemetryHandler: TelemetryHandler | null = null;
  private forensicHandler: ForensicHandler | null = null;
  private incidentHandler: IncidentHandler | null = null;
  private reproductionVerdictHandler: ReproductionVerdictHandler | null = null;
  private accessibilityHandler: AccessibilityHandler | null = null;
  private frameHandler: FrameHandler | null = null;
  private urlChangedHandler: UrlChangedHandler | null = null;
  private browserConsoleHandler: BrowserConsoleHandler | null = null;
  private reconnectingHandler: ReconnectingHandler | null = null;
  private reconnectFailedHandler: ReconnectFailedHandler | null = null;
  private sessionSnapshotHandler: SessionSnapshotHandler | null = null;
  private queueUpdateHandler: QueueUpdateHandler | null = null;
  private timeSyncHandler: TimeSyncHandler | null = null;
  // Invoked when every attach retry failed — the coordinator falls back to the
  // HTTP snapshot so a run we own is never lost to a room we couldn't join.
  private attachExhaustedHandler: (() => void) | null = null;
  // jobId + runId of the enqueued run this client is tracking; re-sent on every
  // (re)connect so a drop during the queued phase rejoins the position stream.
  private queueSubscription: QueueSubscribeRequest | null = null;

  constructor(apiBaseUrl: string, socketUrl: string) {
    // Use hybrid fallback: environment variable first, then window.location.origin for proxy-aware routing
    const resolvedSocketUrl = socketUrl || (typeof window !== 'undefined' ? window.location.origin : apiBaseUrl);

    // Fix: Use polling first, fallback to WebSocket - more reliable for initial connection
    // Also add forceJSONP for environments that block WebSocket upgrade
    this.socket = io(resolvedSocketUrl, {
      autoConnect: false,
      // Prefer polling first for reliability - will upgrade to websocket if available
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: RECONNECT.attempts,
      reconnectionDelay: RECONNECT.delayMs,
      reconnectionDelayMax: RECONNECT.delayMaxMs,
      // Jitter the exponential backoff so many dashboards don't reconnect in lockstep.
      randomizationFactor: RECONNECT.jitter,
      // Add timeout for connection attempts
      timeout: 20000,
      // Present the JWT on every (re)connect so the backend can bind an
      // authenticated run's room. Function form re-reads the (possibly rotated)
      // token each handshake; guests send undefined and fall to possession-proof.
      auth: (cb) => cb({ token: storedAuthToken() ?? undefined }),
    });
  }

  /** Current connection state — read by the coordinator's forceStop to choose socket vs. HTTP. */
  public get connectionState(): ConnectionState {
    return this.connectionStateValue;
  }

  /** Seed / update the run token used for re-attach on (re)connect. */
  public setRunId(runId: string | null): void {
    this.runId = runId;
  }

  /**
   * Present the owned run token and (re)join its room. Called on every connect
   * and explicitly right after a fresh run starts — the socket may already be
   * connected then, so it wouldn't otherwise pick up the newly-created room.
   *
   * No-ops when there is nothing to attach to (no run token AND no identity):
   * the backend has no way to match such a socket to a run, so the emit could
   * only ever come back `no-active-session`. That is the normal state of a fresh
   * page load, and attaching anyway is what filled the console with rejections.
   */
  public reattach(attempt = 0): void {
    const runId = this.runId;
    if (!canAttach(runId, storedAuthToken())) {
      logger.debug('[Gateway] No run token or identity — skipping session attach.');
      return;
    }
    this.socket.emit(SESSION_ATTACH_EVENT, { runToken: runId ?? undefined }, (ack: SessionAttachAck) => {
      if (ack?.attached) {
        if (ack.snapshot) this.sessionSnapshotHandler?.(ack.snapshot);
        return;
      }
      // A failed attach used to be swallowed, leaving the client silently outside
      // the run room for the rest of the session. Retry briefly: the run may be
      // moments from existing (or, in queue mode, still being handed to a worker).
      if (!runId || ack?.reason === 'not-owner') {
        // Identity-only probe finding no run of ours is the expected answer for a
        // signed-in operator with nothing running — not a fault worth warning about.
        if (!runId && ack?.reason === 'no-active-session') {
          logger.debug('[Gateway] No active run owned by this identity.');
          return;
        }
        console.warn('[Gateway] Attach rejected:', ack?.reason ?? 'unknown');
        return;
      }
      if (attempt >= ATTACH_RETRY_DELAYS_MS.length) {
        console.warn(`[Gateway] Attach to run ${runId} gave up after ${attempt} retries (${ack?.reason ?? 'unknown'})`);
        this.attachExhaustedHandler?.();
        return;
      }
      // Late-joiner guard: the run token is still ours, so keep trying.
      setTimeout(() => {
        if (this.runId === runId) this.reattach(attempt + 1);
      }, ATTACH_RETRY_DELAYS_MS[attempt]);
    });
  }

  /**
   * Track an enqueued run: join its queue-position room + future run room and
   * start receiving QUEUE_UPDATE pushes. Remembered so a reconnect re-subscribes.
   */
  public subscribeQueue(jobId: string, runId: string | null): void {
    this.queueSubscription = { jobId, runToken: runId ?? undefined };
    this.emitQueueSubscribe();
  }

  /** Stop tracking once the run goes live (telemetry takes over) or is abandoned. */
  public clearQueueSubscription(): void {
    this.queueSubscription = null;
  }

  private emitQueueSubscribe(): void {
    if (this.queueSubscription) {
      this.socket.emit(QUEUE_SUBSCRIBE_EVENT, this.queueSubscription);
    }
  }

  public connect(): void {
    // Set connection state to connecting
    this.connectionStateValue = 'connecting';

    // Set up connection timeout to detect failed connections
    this.connectionTimeoutId = setTimeout(() => {
      if (this.connectionStateValue === 'connecting') {
        console.warn('[Gateway] Connection timeout - server may not be responding');
        this.connectionStateValue = 'disconnected';
        // Notify the store so it can distinguish "never connected" from "connecting".
        this.connectedHandler?.(false);
      }
    }, this.CONNECTION_TIMEOUT_MS);

    // Set up error handlers for better diagnostics
    this.socket.on('connect_error', (error: Error) => {
      console.error('[Gateway] Connection error:', error.message);
      // Clear the timeout since we got a response (even if it's an error)
      if (this.connectionTimeoutId) {
        clearTimeout(this.connectionTimeoutId);
        this.connectionTimeoutId = null;
      }
    });

    this.socket.on('error', (error: Error) => {
      console.error('[Gateway] Socket error:', error.message);
    });

    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('telemetry', this.handleTelemetry);
    this.socket.on('forensic-report', this.handleForensicReport);
    this.socket.on('incident-report', this.handleIncidentReport);
    this.socket.on(REPRODUCTION_VERDICT_EVENT, this.handleReproductionVerdict);
    this.socket.on(ACCESSIBILITY_EVENT, this.handleAccessibility);
    this.socket.on('live-frame', this.handleLiveFrame);
    this.socket.on('url-changed', this.handleUrlChanged);
    this.socket.on('browser-console', this.handleBrowserConsole);
    this.socket.on(SESSION_SNAPSHOT_EVENT, this.handleSessionSnapshot);
    this.socket.on(QUEUE_UPDATE_EVENT, this.handleQueueUpdate);
    this.socket.on(TIME_SYNC_EVENT, this.handleTimeSync);

    // Manager-level reconnection lifecycle drives the "reconnecting…" overlay.
    this.socket.io.on('reconnect_attempt', this.handleReconnectAttempt);
    // A successful reconnect clears the overlay; exhausting the budget latches a
    // terminal "connection lost, reload" state instead of a frozen "attempt N".
    this.socket.io.on('reconnect', this.handleReconnect);
    this.socket.io.on('reconnect_failed', this.handleReconnectFailed);

    this.socket.connect();
  }

  public disconnect(): void {
    // Clear connection timeout
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
    this.connectionStateValue = 'disconnected';

    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('telemetry', this.handleTelemetry);
    this.socket.off('forensic-report', this.handleForensicReport);
    this.socket.off('incident-report', this.handleIncidentReport);
    this.socket.off(REPRODUCTION_VERDICT_EVENT, this.handleReproductionVerdict);
    this.socket.off(ACCESSIBILITY_EVENT, this.handleAccessibility);
    this.socket.off('live-frame', this.handleLiveFrame);
    this.socket.off('url-changed', this.handleUrlChanged);
    this.socket.off('browser-console', this.handleBrowserConsole);
    this.socket.off(SESSION_SNAPSHOT_EVENT, this.handleSessionSnapshot);
    this.socket.off(QUEUE_UPDATE_EVENT, this.handleQueueUpdate);
    this.socket.off(TIME_SYNC_EVENT, this.handleTimeSync);
    this.socket.io.off('reconnect_attempt', this.handleReconnectAttempt);
    this.socket.io.off('reconnect', this.handleReconnect);
    this.socket.io.off('reconnect_failed', this.handleReconnectFailed);
    this.socket.off('connect_error');
    this.socket.off('error');
    this.socket.disconnect();
  }

  /**
   * Force a fresh handshake, dropping everything tied to the previous identity.
   * The `auth` callback is evaluated once per handshake, so swapping the stored
   * token in place never reaches the server — an account switch would keep
   * presenting the OLD account's JWT until the next network drop. The run token
   * and queue subscription are cleared because they belonged to that account.
   */
  public reconnect(): void {
    this.runId = null;
    this.queueSubscription = null;
    this.disconnect();
    this.connect();
  }

  public pauseTest(): void {
    this.socket.emit('pause-test');
  }

  public resumeTest(): void {
    this.socket.emit('resume-test');
  }

  public stopTest(): void {
    this.socket.emit('stop-test');
  }

  /**
   * Emit stop over the socket (used by the coordinator's forceStop when
   * connected). Resolves after a short window so the emit reaches the wire.
   */
  public stopViaSocket(reason: StopReason = 'operator'): Promise<void> {
    logger.debug('[Gateway] Attempting stop via socket...');
    return new Promise((resolve) => {
      this.socket.emit('stop-test', { reason });
      // Give socket time to send before resolving
      setTimeout(() => {
        logger.debug('[Gateway] Socket stop sent');
        resolve();
      }, 100);
    });
  }

  private readonly handleConnect = (): void => {
    // Clear connection timeout on successful connection
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
    this.connectionStateValue = 'connected';
    logger.debug('[Gateway] Connected successfully');
    this.connectedHandler?.(true);

    // Re-attach to the owned run (if any). The backend replays the buffered
    // session into this socket via the ack — closing any gap opened by the drop.
    this.reattach();
    // Re-join the queue-position stream if we dropped while still waiting in line.
    this.emitQueueSubscribe();
  };

  private readonly handleDisconnect = (): void => {
    this.connectionStateValue = 'disconnected';
    this.connectedHandler?.(false);
  };

  private readonly handleReconnectAttempt = (attempt: number): void => {
    this.connectionStateValue = 'reconnecting';
    this.reconnectingHandler?.(attempt);
  };

  // Socket.IO's own 'connect' also fires, driving the connected handler; this just
  // guarantees the reconnecting/terminal overlay is cleared on recovery.
  private readonly handleReconnect = (): void => {
    this.connectionStateValue = 'connected';
    this.connectedHandler?.(true);
  };

  private readonly handleReconnectFailed = (): void => {
    console.warn('[Gateway] Reconnection attempts exhausted');
    this.connectionStateValue = 'disconnected';
    this.reconnectFailedHandler?.();
  };

  private readonly handleTelemetry = (event: TelemetryEvent): void => {
    this.telemetryHandler?.(event);
  };

  private readonly handleForensicReport = (report: ForensicCrashReport): void => {
    this.forensicHandler?.(report);
  };

  private readonly handleIncidentReport = (report: IncidentReport): void => {
    this.incidentHandler?.(report);
  };

  private readonly handleReproductionVerdict = (verdict: ReproductionVerdict): void => {
    this.reproductionVerdictHandler?.(verdict);
  };

  private readonly handleAccessibility = (finding: AccessibilityFinding): void => {
    this.accessibilityHandler?.(finding);
  };

  private readonly handleLiveFrame = (base64Jpeg: string): void => {
    this.frameHandler?.(base64Jpeg);
  };

  private readonly handleUrlChanged = (url: string): void => {
    this.urlChangedHandler?.(url);
  };

  private readonly handleBrowserConsole = (message: BrowserConsoleMessage): void => {
    this.browserConsoleHandler?.(message);
  };

  private readonly handleSessionSnapshot = (snapshot: ActiveSessionSnapshot): void => {
    this.sessionSnapshotHandler?.(snapshot);
  };

  private readonly handleTimeSync = (payload: TimeSyncPayload): void => {
    this.timeSyncHandler?.(payload);
  };

  private readonly handleQueueUpdate = (update: QueueUpdate): void => {
    // Drop tracking only on a terminal outcome. We deliberately keep the
    // subscription through 'active' so a mid-run reconnect re-joins run:${runId}
    // (a worker run lives in another process; this is our only room-rejoin path).
    if (update.state === 'completed' || update.state === 'failed') {
      this.clearQueueSubscription();
    }
    this.queueUpdateHandler?.(update);
  };

  public onConnected(handler: ConnectedHandler): void {
    this.connectedHandler = handler;
  }
  public onTelemetry(handler: TelemetryHandler): void {
    this.telemetryHandler = handler;
  }
  public onForensicReport(handler: ForensicHandler): void {
    this.forensicHandler = handler;
  }
  public onIncidentReport(handler: IncidentHandler): void {
    this.incidentHandler = handler;
  }
  public onReproductionVerdict(handler: ReproductionVerdictHandler): void {
    this.reproductionVerdictHandler = handler;
  }
  public onAccessibility(handler: AccessibilityHandler): void {
    this.accessibilityHandler = handler;
  }
  public onLiveFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }
  public onUrlChanged(handler: UrlChangedHandler): void {
    this.urlChangedHandler = handler;
  }
  public onBrowserConsole(handler: BrowserConsoleHandler): void {
    this.browserConsoleHandler = handler;
  }
  public onReconnecting(handler: ReconnectingHandler): void {
    this.reconnectingHandler = handler;
  }
  public onReconnectFailed(handler: ReconnectFailedHandler): void {
    this.reconnectFailedHandler = handler;
  }
  public onSessionSnapshot(handler: SessionSnapshotHandler): void {
    this.sessionSnapshotHandler = handler;
  }
  public onQueueUpdate(handler: QueueUpdateHandler): void {
    this.queueUpdateHandler = handler;
  }
  public onTimeSync(handler: TimeSyncHandler): void {
    this.timeSyncHandler = handler;
  }
  public onAttachExhausted(handler: () => void): void {
    this.attachExhaustedHandler = handler;
  }
  /** Route an out-of-band snapshot (HTTP fallback) through the normal handler. */
  public emitSessionSnapshot(snapshot: ActiveSessionSnapshot): void {
    this.sessionSnapshotHandler?.(snapshot);
  }
  public removeAllListeners(): void {
    this.attachExhaustedHandler = null;
    this.reconnectFailedHandler = null;
    this.connectedHandler = null;
    this.telemetryHandler = null;
    this.forensicHandler = null;
    this.incidentHandler = null;
    this.reproductionVerdictHandler = null;
    this.accessibilityHandler = null;
    this.frameHandler = null;
    this.urlChangedHandler = null;
    this.browserConsoleHandler = null;
    this.reconnectingHandler = null;
    this.sessionSnapshotHandler = null;
    this.queueUpdateHandler = null;
  }
}

import { io, type Socket } from 'socket.io-client';
import type { BrowserConsoleMessage } from '../../../application/ports/EngineGateway';
import type { AccessibilityFinding, ActiveSessionSnapshot, ForensicCrashReport, IncidentReport, SessionAttachAck, TelemetryEvent } from '../../../types';
import { ACCESSIBILITY_EVENT, SESSION_ATTACH_EVENT, SESSION_SNAPSHOT_EVENT } from '../../../types';

type ConnectedHandler = (connected: boolean) => void;
type TelemetryHandler = (event: TelemetryEvent) => void;
type ForensicHandler = (report: ForensicCrashReport) => void;
type IncidentHandler = (report: IncidentReport) => void;
type AccessibilityHandler = (finding: AccessibilityFinding) => void;
type FrameHandler = (base64Jpeg: string) => void;
type UrlChangedHandler = (url: string) => void;
type BrowserConsoleHandler = (message: BrowserConsoleMessage) => void;
type ReconnectingHandler = (attempt: number) => void;
type SessionSnapshotHandler = (snapshot: ActiveSessionSnapshot) => void;

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

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
  private accessibilityHandler: AccessibilityHandler | null = null;
  private frameHandler: FrameHandler | null = null;
  private urlChangedHandler: UrlChangedHandler | null = null;
  private browserConsoleHandler: BrowserConsoleHandler | null = null;
  private reconnectingHandler: ReconnectingHandler | null = null;
  private sessionSnapshotHandler: SessionSnapshotHandler | null = null;

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
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Add timeout for connection attempts
      timeout: 20000,
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
   */
  public reattach(): void {
    this.socket.emit(SESSION_ATTACH_EVENT, { runId: this.runId ?? undefined }, (ack: SessionAttachAck) => {
      if (ack?.attached && ack.snapshot) {
        this.sessionSnapshotHandler?.(ack.snapshot);
      }
    });
  }

  public connect(): void {
    // Set connection state to connecting
    this.connectionStateValue = 'connecting';

    // Set up connection timeout to detect failed connections
    this.connectionTimeoutId = setTimeout(() => {
      if (this.connectionStateValue === 'connecting') {
        console.warn('[Gateway] Connection timeout - server may not be responding');
        this.connectionStateValue = 'disconnected';
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
    this.socket.on(ACCESSIBILITY_EVENT, this.handleAccessibility);
    this.socket.on('live-frame', this.handleLiveFrame);
    this.socket.on('url-changed', this.handleUrlChanged);
    this.socket.on('browser-console', this.handleBrowserConsole);
    this.socket.on(SESSION_SNAPSHOT_EVENT, this.handleSessionSnapshot);

    // Manager-level reconnection lifecycle drives the "reconnecting…" overlay.
    this.socket.io.on('reconnect_attempt', this.handleReconnectAttempt);

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
    this.socket.off(ACCESSIBILITY_EVENT, this.handleAccessibility);
    this.socket.off('live-frame', this.handleLiveFrame);
    this.socket.off('url-changed', this.handleUrlChanged);
    this.socket.off('browser-console', this.handleBrowserConsole);
    this.socket.off(SESSION_SNAPSHOT_EVENT, this.handleSessionSnapshot);
    this.socket.io.off('reconnect_attempt', this.handleReconnectAttempt);
    this.socket.off('connect_error');
    this.socket.off('error');
    this.socket.disconnect();
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
  public stopViaSocket(): Promise<void> {
    console.log('[Gateway] Attempting stop via socket...');
    return new Promise((resolve) => {
      this.socket.emit('stop-test');
      // Give socket time to send before resolving
      setTimeout(() => {
        console.log('[Gateway] Socket stop sent');
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
    console.log('[Gateway] Connected successfully');
    this.connectedHandler?.(true);

    // Re-attach to the owned run (if any). The backend replays the buffered
    // session into this socket via the ack — closing any gap opened by the drop.
    this.reattach();
  };

  private readonly handleDisconnect = (): void => {
    this.connectionStateValue = 'disconnected';
    this.connectedHandler?.(false);
  };

  private readonly handleReconnectAttempt = (attempt: number): void => {
    this.connectionStateValue = 'reconnecting';
    this.reconnectingHandler?.(attempt);
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
  public onSessionSnapshot(handler: SessionSnapshotHandler): void {
    this.sessionSnapshotHandler = handler;
  }
  public removeAllListeners(): void {
    this.connectedHandler = null;
    this.telemetryHandler = null;
    this.forensicHandler = null;
    this.incidentHandler = null;
    this.accessibilityHandler = null;
    this.frameHandler = null;
    this.urlChangedHandler = null;
    this.browserConsoleHandler = null;
    this.reconnectingHandler = null;
    this.sessionSnapshotHandler = null;
  }
}

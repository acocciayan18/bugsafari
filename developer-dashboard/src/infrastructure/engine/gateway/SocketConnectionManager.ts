import { io, type Socket } from 'socket.io-client';
import type { BrowserConsoleMessage } from '../../../application/ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../types';

type ConnectedHandler = (connected: boolean) => void;
type TelemetryHandler = (event: TelemetryEvent) => void;
type ForensicHandler = (report: ForensicCrashReport) => void;
type IncidentHandler = (report: IncidentReport) => void;
type FrameHandler = (base64Jpeg: string) => void;
type UrlChangedHandler = (url: string) => void;
type BrowserConsoleHandler = (message: BrowserConsoleMessage) => void;

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Socket.IO lifecycle + event binding/dispatch for the engine gateway. Owns the
 * socket, connection state, the bind/unbind blocks, every server→client handler,
 * the on* subscriber registration, and the frontend→backend control emits
 * (pause/resume/stop). The coordinator composes this alongside the HTTP client.
 */
export class SocketConnectionManager {
  private readonly socket: Socket;

  // Connection state tracking
  private connectionStateValue: ConnectionState = 'disconnected';
  private connectionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly CONNECTION_TIMEOUT_MS = 10000; // 10 second timeout for initial connection

  private connectedHandler: ConnectedHandler | null = null;
  private telemetryHandler: TelemetryHandler | null = null;
  private forensicHandler: ForensicHandler | null = null;
  private incidentHandler: IncidentHandler | null = null;
  private frameHandler: FrameHandler | null = null;
  private urlChangedHandler: UrlChangedHandler | null = null;
  private browserConsoleHandler: BrowserConsoleHandler | null = null;

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
    this.socket.on('live-frame', this.handleLiveFrame);
    this.socket.on('url-changed', this.handleUrlChanged);
    this.socket.on('browser-console', this.handleBrowserConsole);

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
    this.socket.off('live-frame', this.handleLiveFrame);
    this.socket.off('url-changed', this.handleUrlChanged);
    this.socket.off('browser-console', this.handleBrowserConsole);
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
  };

  private readonly handleDisconnect = (): void => {
    this.connectionStateValue = 'disconnected';
    this.connectedHandler?.(false);
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

  private readonly handleLiveFrame = (base64Jpeg: string): void => {
    this.frameHandler?.(base64Jpeg);
  };

  private readonly handleUrlChanged = (url: string): void => {
    this.urlChangedHandler?.(url);
  };

  private readonly handleBrowserConsole = (message: BrowserConsoleMessage): void => {
    this.browserConsoleHandler?.(message);
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
  public onLiveFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }
  public onUrlChanged(handler: UrlChangedHandler): void {
    this.urlChangedHandler = handler;
  }
  public onBrowserConsole(handler: BrowserConsoleHandler): void {
    this.browserConsoleHandler = handler;
  }

  public removeAllListeners(): void {
    this.connectedHandler = null;
    this.telemetryHandler = null;
    this.forensicHandler = null;
    this.incidentHandler = null;
    this.frameHandler = null;
    this.urlChangedHandler = null;
    this.browserConsoleHandler = null;
  }
}

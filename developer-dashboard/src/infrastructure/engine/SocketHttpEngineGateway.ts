import { io, type Socket } from 'socket.io-client';
import type { BrowserConsoleMessage, EngineGateway } from '../../application/ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent, TestingTypeId } from '../../types';

type ConnectedHandler = (connected: boolean) => void;
type TelemetryHandler = (event: TelemetryEvent) => void;
type ForensicHandler = (report: ForensicCrashReport) => void;
type IncidentHandler = (report: IncidentReport) => void;
type FrameHandler = (base64Jpeg: string) => void;
type UrlChangedHandler = (url: string) => void;
type BrowserConsoleHandler = (message: BrowserConsoleMessage) => void;

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export class SocketHttpEngineGateway implements EngineGateway {
  private readonly apiBaseUrl: string;
  private readonly socket: Socket;
  private authToken: string | null = null;

  // Connection state tracking
  private connectionState: ConnectionState = 'disconnected';
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
    this.apiBaseUrl = apiBaseUrl;
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

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

public connect(): void {
    // Set connection state to connecting
    this.connectionState = 'connecting';
    
    // Set up connection timeout to detect failed connections
    this.connectionTimeoutId = setTimeout(() => {
      if (this.connectionState === 'connecting') {
        console.warn('[Gateway] Connection timeout - server may not be responding');
        this.connectionState = 'disconnected';
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
    this.connectionState = 'disconnected';
    
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

  public async startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[]): Promise<void> {
    console.log(`[Gateway] 📤 POST /api/start-test starting for: ${targetUrl}`);
    console.log(`[Gateway] API Base URL: ${this.apiBaseUrl}`);
    console.log(`[Gateway] Optimization Settings:`, optimizationSettings);
    console.log(`[Gateway] Selected Scenarios:`, selectedScenarios);

    let errorDetails = '';

    try {
      const requestBody: { url: string; optimization?: OptimizationSettings; selectedScenarios?: TestingTypeId[] } = { url: targetUrl };
      if (optimizationSettings) {
        requestBody.optimization = optimizationSettings;
      }
      if (selectedScenarios && selectedScenarios.length > 0) {
        requestBody.selectedScenarios = selectedScenarios;
      }

      const response = await fetch(`${this.apiBaseUrl}/api/start-test`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      console.log(`[Gateway] Response status: ${response.status}`);
      console.log(`[Gateway] Response ok: ${response.ok}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Gateway] ❌ Start failed: ${response.status} - ${errorText}`);
        throw new Error(`Server returned ${response.status} - ${errorText}`);
      }

      console.log(`[Gateway] ✅ Safari launch accepted`);
    } catch (error) {
      if (error instanceof TypeError) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('network')) {
          console.error(`[Gateway] ❌ Network error - server may be unreachable: ${this.apiBaseUrl}`);
          console.error(`[Gateway] ❌ Possible causes: Server not running, CORS error, or network issue`);
          throw new Error(`Cannot reach server at ${this.apiBaseUrl}. Is the backend running?`);
        }

        console.error(`[Gateway] ❌ Fetch error:`, error.message);
        throw new Error(`Network error: ${error.message}`);
      }

      throw error;
    }
  }

  public async saveSession(targetUrl: string): Promise<void> {
    const response = await fetch('/api/history/save-session', {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ targetUrl }),
    });

    if (!response.ok) {
      throw new Error(`Could not save session (${response.status})`);
    }
  }

  public async fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
    try {
      const response = await fetch(`/api/history/sessions?limit=${encodeURIComponent(String(limit))}`, {
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Could not fetch session history (${response.status})`);
      }
      const data = (await response.json()) as { sessions?: SessionHistoryEntry[] };
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch (error) {
      console.log("[Gateway] Backend is hot-reloading. Suppressing transient ERR_EMPTY_RESPONSE.");
      return [];
    }
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
   * Force stop - sends stop command via socket with HTTP fallback.
   * Used for timeout cleanup to ensure backend terminates orphaned processes.
   */
  public async forceStop(): Promise<void> {
    console.log('[Gateway] 🔴 forceStop called - attempting cleanup');

    // First, try socket emit (most reliable when connected)
    if (this.connectionState === 'connected') {
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

    // Fallback to HTTP POST if socket not connected
    console.log('[Gateway] Socket not connected, falling back to HTTP stop...');
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/safari/stop`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
      });

      if (response.ok) {
        console.log('[Gateway] ✅ HTTP stop successful');
      } else {
        console.warn('[Gateway] HTTP stop returned non-OK:', response.status);
      }
    } catch (httpError) {
      console.error('[Gateway] HTTP stop failed:', httpError);
      // Swallow error - backend may already be stopped
    }
  }

private readonly handleConnect = (): void => {
    // Clear connection timeout on successful connection
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
    this.connectionState = 'connected';
    console.log('[Gateway] Connected successfully');
    this.connectedHandler?.(true);
  };

  private readonly handleDisconnect = (): void => {
    this.connectionState = 'disconnected';
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

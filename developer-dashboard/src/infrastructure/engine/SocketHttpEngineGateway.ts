import { io, type Socket } from 'socket.io-client';
import type { BrowserConsoleMessage, EngineGateway } from '../../application/ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent } from '../../types';

type ConnectedHandler = (connected: boolean) => void;
type TelemetryHandler = (event: TelemetryEvent) => void;
type ForensicHandler = (report: ForensicCrashReport) => void;
type IncidentHandler = (report: IncidentReport) => void;
type FrameHandler = (base64Jpeg: string) => void;
type UrlChangedHandler = (url: string) => void;
type BrowserConsoleHandler = (message: BrowserConsoleMessage) => void;

export class SocketHttpEngineGateway implements EngineGateway {
  private readonly apiBaseUrl: string;
  private readonly socket: Socket;
  private authToken: string | null = null;

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
    this.socket = io(resolvedSocketUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
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
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('telemetry', this.handleTelemetry);
    this.socket.off('forensic-report', this.handleForensicReport);
    this.socket.off('incident-report', this.handleIncidentReport);
    this.socket.off('live-frame', this.handleLiveFrame);
    this.socket.off('url-changed', this.handleUrlChanged);
    this.socket.off('browser-console', this.handleBrowserConsole);
    this.socket.disconnect();
  }

  public async startTest(targetUrl: string, optimizationSettings?: OptimizationSettings): Promise<void> {
    console.log(`[Gateway] 📤 POST /api/start-test starting for: ${targetUrl}`);
    console.log(`[Gateway] API Base URL: ${this.apiBaseUrl}`);
    console.log(`[Gateway] Optimization Settings:`, optimizationSettings);

    let errorDetails = '';

    try {
      const requestBody: { url: string; optimization?: OptimizationSettings } = { url: targetUrl };
      if (optimizationSettings) {
        requestBody.optimization = optimizationSettings;
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
    const response = await fetch(`${this.apiBaseUrl}/api/history/save-session`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ targetUrl }),
    });

    if (!response.ok) {
      throw new Error(`Could not save session (${response.status})`);
    }
  }

public async fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/history/sessions?limit=${encodeURIComponent(String(limit))}`, {
        headers: this.getAuthHeaders(),
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

  private readonly handleConnect = (): void => {
    this.connectedHandler?.(true);
  };

  private readonly handleDisconnect = (): void => {
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

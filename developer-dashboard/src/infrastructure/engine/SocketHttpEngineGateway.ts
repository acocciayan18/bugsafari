import type { BrowserConsoleMessage, EngineGateway } from '../../application/ports/EngineGateway';
import type { ActiveSessionSnapshot, ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent, ExplorationRunConfig } from '../../types';
import { EngineHttpClient } from './gateway/EngineHttpClient';
import { SocketConnectionManager } from './gateway/SocketConnectionManager';

/**
 * Coordinator (facade) for the engine gateway. Composes the socket lifecycle /
 * event-dispatch manager and the HTTP/REST client, forwarding the EngineGateway
 * surface to whichever sub-module owns each concern. The class name, constructor
 * signature, and public methods are preserved so existing consumers (App.tsx,
 * useDashboardController) need no changes.
 */
export class SocketHttpEngineGateway implements EngineGateway {
  private readonly http: EngineHttpClient;
  private readonly connection: SocketConnectionManager;
  // Server-issued run token for the active run this client owns.
  private runId: string | null = null;

  constructor(apiBaseUrl: string, socketUrl: string) {
    this.http = new EngineHttpClient(apiBaseUrl);
    this.connection = new SocketConnectionManager(apiBaseUrl, socketUrl);
  }

  public setAuthToken(token: string | null): void {
    this.http.setAuthToken(token);
  }

  public setRunId(runId: string | null): void {
    this.runId = runId;
    this.connection.setRunId(runId);
  }

  public fetchActiveSession(): Promise<ActiveSessionSnapshot | null> {
    return this.http.fetchActiveSession(this.runId);
  }

  // ── Socket lifecycle ──────────────────────────────────────────
  public connect(): void {
    this.connection.connect();
  }

  public disconnect(): void {
    this.connection.disconnect();
  }

  // ── HTTP/REST routines ────────────────────────────────────────
  public async startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig): Promise<string | null> {
    const runId = await this.http.startTest(targetUrl, optimizationSettings, infiltration);
    // Persist the token so the socket re-attaches to THIS run on reconnect.
    this.setRunId(runId);
    // The socket is typically already connected here, so join the freshly-created
    // run room now — otherwise room-scoped telemetry would only reach us via the
    // reconnect path.
    if (runId) this.connection.reattach();
    return runId;
  }

  public saveSession(targetUrl: string): Promise<void> {
    return this.http.saveSession(targetUrl);
  }

  public fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
    return this.http.fetchSessionHistory(limit);
  }

  // ── Run controls (socket emits) ───────────────────────────────
  public pauseTest(): void {
    this.connection.pauseTest();
  }

  public resumeTest(): void {
    this.connection.resumeTest();
  }

  public stopTest(): void {
    this.connection.stopTest();
  }

  /**
   * Force stop - sends stop command via socket with HTTP fallback.
   * Used for timeout cleanup to ensure backend terminates orphaned processes.
   */
  public async forceStop(): Promise<void> {
    console.log('[Gateway] 🔴 forceStop called - attempting cleanup');

    // First, try socket emit (most reliable when connected)
    if (this.connection.connectionState === 'connected') {
      return this.connection.stopViaSocket();
    }

    // Fallback to HTTP POST if socket not connected
    return this.http.stopViaHttp();
  }

  // ── Server→client subscriber registration ─────────────────────
  public onConnected(handler: (connected: boolean) => void): void {
    this.connection.onConnected(handler);
  }
  public onTelemetry(handler: (event: TelemetryEvent) => void): void {
    this.connection.onTelemetry(handler);
  }
  public onForensicReport(handler: (report: ForensicCrashReport) => void): void {
    this.connection.onForensicReport(handler);
  }
  public onIncidentReport(handler: (report: IncidentReport) => void): void {
    this.connection.onIncidentReport(handler);
  }
  public onLiveFrame(handler: (base64Jpeg: string) => void): void {
    this.connection.onLiveFrame(handler);
  }
  public onUrlChanged(handler: (url: string) => void): void {
    this.connection.onUrlChanged(handler);
  }
  public onBrowserConsole(handler: (message: BrowserConsoleMessage) => void): void {
    this.connection.onBrowserConsole(handler);
  }
  public onReconnecting(handler: (attempt: number) => void): void {
    this.connection.onReconnecting(handler);
  }
  public onSessionSnapshot(handler: (snapshot: ActiveSessionSnapshot) => void): void {
    this.connection.onSessionSnapshot(handler);
  }
  public removeAllListeners(): void {
    this.connection.removeAllListeners();
  }
}

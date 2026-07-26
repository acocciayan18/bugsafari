import type { BrowserConsoleMessage, EngineGateway, StartTestResult, StopRunResult } from '../../application/ports/EngineGateway';
import type { AccessibilityFinding, ActiveSessionSnapshot, ForensicCrashReport, IncidentReport, OptimizationSettings, QueueUpdate, ReproductionVerdict, SessionHistoryEntry, StopReason, TargetAuthConfig, TelemetryEvent, TimeSyncPayload, ExplorationRunConfig } from '../../types';
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
    // Socket attach exhausted its retries — ask the server directly rather than
    // leaving the dashboard on a stream it never joined.
    this.connection.onAttachExhausted(() => {
      void this.fetchActiveSession()
        .then((snapshot) => { if (snapshot) this.connection.emitSessionSnapshot(snapshot); })
        .catch((error) => console.error('[Gateway] Snapshot fallback failed:', error));
    });
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

  /** Re-join a restored distributed run's queue + run rooms after a refresh. */
  public restoreQueueSubscription(jobId: string, runId: string | null): void {
    this.connection.subscribeQueue(jobId, runId);
  }

  // ── Socket lifecycle ──────────────────────────────────────────
  public connect(): void {
    this.connection.connect();
  }

  public disconnect(): void {
    this.connection.disconnect();
  }

  // ── HTTP/REST routines ────────────────────────────────────────
  public async startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig, targetAuth?: TargetAuthConfig): Promise<StartTestResult> {
    // Present the owned run token so the server resumes an existing session
    // (dedupe) instead of launching a duplicate.
    const result = await this.http.startTest(targetUrl, optimizationSettings, infiltration, this.runId, targetAuth);
    // Persist the token so the socket re-attaches to THIS run on reconnect.
    this.setRunId(result.runId);
    if (result.jobId) {
      // Distributed run (fresh or resumed): track its place in line + join the run
      // room now so bridged worker telemetry reaches us the instant it's active.
      this.connection.subscribeQueue(result.jobId, result.runId);
    } else if (result.runId) {
      // Synchronous run: the socket is typically already connected, so join the
      // freshly-created run room now instead of waiting for the reconnect path.
      this.connection.reattach();
    }
    return result;
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
  public async forceStop(reason: StopReason = 'operator'): Promise<void> {
    console.log(`[Gateway]  forceStop called (reason=${reason}) - attempting cleanup`);

    // First, try socket emit (most reliable when connected)
    if (this.connection.connectionState === 'connected') {
      return this.connection.stopViaSocket(reason);
    }

    // Fallback to HTTP POST if socket not connected. Best-effort by design: the
    // backend may already be stopped, so the outcome is logged, not thrown.
    await this.http.stopRun(this.runId, reason);
  }

  /**
   * Cancel a run that hasn't been picked up by a worker yet. Always HTTP — the
   * socket control channel only reaches a run that is already executing, so a
   * queued job can only be removed through the queue-aware stop endpoint.
   */
  public cancelQueuedRun(): Promise<StopRunResult> {
    console.log('[Gateway]  cancelQueuedRun called for runId:', this.runId);
    return this.http.stopRun(this.runId);
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
  public onReproductionVerdict(handler: (verdict: ReproductionVerdict) => void): void {
    this.connection.onReproductionVerdict(handler);
  }

  public onIncidentReport(handler: (report: IncidentReport) => void): void {
    this.connection.onIncidentReport(handler);
  }
  public onAccessibility(handler: (finding: AccessibilityFinding) => void): void {
    this.connection.onAccessibility(handler);
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
  public onReconnectFailed(handler: () => void): void {
    this.connection.onReconnectFailed(handler);
  }
  public onSessionSnapshot(handler: (snapshot: ActiveSessionSnapshot) => void): void {
    this.connection.onSessionSnapshot(handler);
  }
  public onQueueUpdate(handler: (update: QueueUpdate) => void): void {
    this.connection.onQueueUpdate(handler);
  }
  public onTimeSync(handler: (payload: TimeSyncPayload) => void): void {
    this.connection.onTimeSync(handler);
  }
  public removeAllListeners(): void {
    this.connection.removeAllListeners();
  }
}

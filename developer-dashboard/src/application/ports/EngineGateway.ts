import type { ActiveSessionSnapshot, DecisionRationale, ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent, ExplorationRunConfig } from '../../types';

export interface BrowserConsoleMessage {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  url?: string;
  line?: number;
}

export interface EngineGateway {
  connect(): void;
  disconnect(): void;
  onConnected(handler: (connected: boolean) => void): void;
  onTelemetry(handler: (event: TelemetryEvent) => void): void;
  onForensicReport(handler: (report: ForensicCrashReport) => void): void;
  onIncidentReport(handler: (report: IncidentReport) => void): void;
  onLiveFrame(handler: (base64Jpeg: string) => void): void;
  onUrlChanged(handler: (url: string) => void): void;
  onBrowserConsole(handler: (message: BrowserConsoleMessage) => void): void;
  // Reconnection & recovery.
  onReconnecting(handler: (attempt: number) => void): void;
  onSessionSnapshot(handler: (snapshot: ActiveSessionSnapshot) => void): void;
  /** Glass-box decision rationale stream for the Decision Lens. */
  onDecisionRationale(handler: (rationale: DecisionRationale) => void): void;
  removeAllListeners(): void;
  /** Seed the run token (e.g. from localStorage) so the socket can re-attach on connect. */
  setRunId(runId: string | null): void;
  /** Ask the backend whether the requester owns an active run; null if none. */
  fetchActiveSession(): Promise<ActiveSessionSnapshot | null>;
  /** Launch a run; resolves with the server-issued run token (null if not accepted). */
  startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig): Promise<string | null>;
  saveSession(targetUrl: string): Promise<void>;
  fetchSessionHistory(limit?: number): Promise<SessionHistoryEntry[]>;
  /** Force stop - sends explicit stop to terminate orphaned backend processes on timeout */
  forceStop(): Promise<void>;
}

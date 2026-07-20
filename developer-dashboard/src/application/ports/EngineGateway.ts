import type { AccessibilityFinding, ActiveSessionSnapshot, ForensicCrashReport, IncidentReport, OptimizationSettings, QueueUpdate, ReproductionVerdict, SessionHistoryEntry, TargetAuthConfig, TelemetryEvent, ExplorationRunConfig } from '../../types';

export type BrowserConsoleLevel =
  | 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'notice';

export interface BrowserConsoleMessage {
  timestamp: string;
  level: BrowserConsoleLevel;
  type: string;
  message: string;
  url?: string;
  line?: number;
  column?: number;
  stackTrace?: string;
}

/** Outcome of a start request: a synchronous run yields just a runId; a queued
 *  run additionally yields the jobId used to track its place in line. */
export interface StartTestResult {
  runId: string | null;
  jobId: string | null;
  queued: boolean;
  /** Server matched the request to a session the client already owns — reconnect, don't relaunch. */
  resumed?: boolean;
}

/** Outcome of POST /api/safari/stop — `ok` is the backend's real verdict, never assumed. */
export interface StopRunResult {
  ok: boolean;
  /** A still-waiting queued job was removed before any worker claimed it. */
  cancelled?: boolean;
  /** A running engine received the stop and is unwinding. */
  stopping?: boolean;
  stopped?: boolean;
  alreadyStopped?: boolean;
  jobId?: string;
  message?: string;
  error?: string;
}

export interface EngineGateway {
  connect(): void;
  disconnect(): void;
  onConnected(handler: (connected: boolean) => void): void;
  onTelemetry(handler: (event: TelemetryEvent) => void): void;
  onForensicReport(handler: (report: ForensicCrashReport) => void): void;
  onIncidentReport(handler: (report: IncidentReport) => void): void;
  /** Late verdict patching an already-received finding with its reproduction result. */
  onReproductionVerdict(handler: (verdict: ReproductionVerdict) => void): void;
  /** Dedicated WCAG stream — feeds the isolated Accessibility tab only. */
  onAccessibility(handler: (finding: AccessibilityFinding) => void): void;
  onLiveFrame(handler: (base64Jpeg: string) => void): void;
  onUrlChanged(handler: (url: string) => void): void;
  onBrowserConsole(handler: (message: BrowserConsoleMessage) => void): void;
  // Reconnection & recovery.
  onReconnecting(handler: (attempt: number) => void): void;
  onSessionSnapshot(handler: (snapshot: ActiveSessionSnapshot) => void): void;
  /** Live queue-position / lifecycle pushes for an enqueued (distributed) run. */
  onQueueUpdate(handler: (update: QueueUpdate) => void): void;
  removeAllListeners(): void;
  /** Seed the run token (e.g. from localStorage) so the socket can re-attach on connect. */
  setRunId(runId: string | null): void;
  /** Ask the backend whether the requester owns an active run; null if none. */
  fetchActiveSession(): Promise<ActiveSessionSnapshot | null>;
  /** Re-join a restored distributed run's queue-position + run rooms (post-refresh). */
  restoreQueueSubscription(jobId: string, runId: string | null): void;
  /** Launch a run; resolves with the run token and (when queued) its jobId.
   *  `targetAuth` is ephemeral — it is sent once and never stored anywhere. */
  startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig, targetAuth?: TargetAuthConfig): Promise<StartTestResult>;
  saveSession(targetUrl: string): Promise<void>;
  fetchSessionHistory(limit?: number): Promise<SessionHistoryEntry[]>;
  /** Force stop - sends explicit stop to terminate orphaned backend processes on timeout */
  forceStop(): Promise<void>;
  /** Cancel a run that is still QUEUED (removes the BullMQ job before pickup). */
  cancelQueuedRun(): Promise<StopRunResult>;
}

import type { AccessibilityFinding, ActiveSessionSnapshot, BrowserConsoleMessage, FindingOccurrencePatch, FindingUpgrade, ForensicCrashReport, IncidentReport, OptimizationSettings, QueueUpdate, ReproductionVerdict, SessionHistoryEntry, StopReason, TargetAuthConfig, TelemetryEvent, TimeSyncPayload, ExplorationRunConfig } from '../../types';

// Re-export the single shared console contract so existing port consumers
// (runStore, gatewayBinding, SocketConnectionManager) keep their import path.
export type { BrowserConsoleLevel, BrowserConsoleMessage } from '../../types';

/** Outcome of a start request: a synchronous run yields just a runId; a queued
 *  run additionally yields the jobId used to track its place in line. */
export interface StartTestResult {
  runId: string | null;
  /** Public RUN- code of the accepted run — the identity a later save is keyed to. */
  runCode: string | null;
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
  /** Late patch raising an already-received finding's severity/message to a stronger verdict. */
  onFindingUpgrade(handler: (upgrade: FindingUpgrade) => void): void;
  /** Authoritative repeat-count update for an already-received finding — patches its ×N by bugId. */
  onFindingOccurrence(handler: (patch: FindingOccurrencePatch) => void): void;
  /** Dedicated WCAG stream — feeds the isolated Accessibility tab only. */
  onAccessibility(handler: (finding: AccessibilityFinding) => void): void;
  onLiveFrame(handler: (base64Jpeg: string) => void): void;
  onUrlChanged(handler: (url: string) => void): void;
  onBrowserConsole(handler: (message: BrowserConsoleMessage) => void): void;
  // Reconnection & recovery.
  onReconnecting(handler: (attempt: number) => void): void;
  /** Socket.IO exhausted its reconnection budget — terminal, needs a manual reload. */
  onReconnectFailed(handler: () => void): void;
  /**
   * The socket exhausted its attach retries AND an HTTP snapshot confirmed there is
   * no active run for this client — the run is authoritatively gone. Lets the store
   * release a phantom-live UI instead of hanging on a stream that will never arrive
   * (a run that ended while the socket was down under a slow link).
   */
  onRunAbsent(handler: () => void): void;
  onSessionSnapshot(handler: (snapshot: ActiveSessionSnapshot) => void): void;
  /** Live queue-position / lifecycle pushes for an enqueued (distributed) run. */
  onQueueUpdate(handler: (update: QueueUpdate) => void): void;
  /** Authoritative timebox clock (~1 Hz) the frontend timer slaves to. */
  onTimeSync(handler: (payload: TimeSyncPayload) => void): void;
  removeAllListeners(): void;
  /** Seed the run token (e.g. from localStorage) so the socket can re-attach on connect. */
  setRunId(runId: string | null): void;
  /** Current run token, or null. Lets a restore tell a same-run reconcile from a fresh hydrate. */
  getRunId(): string | null;
  /** Install the access token used by every protected HTTP call. Must be set
   *  before the first such call, or it goes out bare and 401s. */
  setAuthToken(token: string | null): void;
  /** Ask the backend whether the requester owns an active run; null if none. */
  fetchActiveSession(): Promise<ActiveSessionSnapshot | null>;
  /** Re-join a restored distributed run's queue-position + run rooms (post-refresh). */
  restoreQueueSubscription(jobId: string, runId: string | null): void;
  /** Launch a run; resolves with the run token and (when queued) its jobId.
   *  `targetAuth` is ephemeral — it is sent once and never stored anywhere. */
  startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig, targetAuth?: TargetAuthConfig): Promise<StartTestResult>;
  /** Pause the live engine (socket emit); no-op if the run isn't executing. */
  pauseTest(): void;
  /** Resume a paused engine (socket emit). */
  resumeTest(): void;
  /** Stop the live engine (socket emit); for QUEUED runs use cancelQueuedRun. */
  stopTest(): void;
  /** Force a fresh socket handshake under the current identity (account switch). */
  reconnect(): void;
  saveSession(targetUrl: string): Promise<void>;
  fetchSessionHistory(limit?: number): Promise<SessionHistoryEntry[]>;
  /** Force stop - sends explicit stop to terminate orphaned backend processes on timeout.
   *  `reason` attributes the stop (default operator); the timebox timer passes 'timebox'. */
  forceStop(reason?: StopReason): Promise<void>;
  /** Cancel a run that is still QUEUED (removes the BullMQ job before pickup). */
  cancelQueuedRun(): Promise<StopRunResult>;
}

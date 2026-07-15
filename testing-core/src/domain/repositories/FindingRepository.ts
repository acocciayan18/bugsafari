export interface CreateSessionInput {
  targetUrl: string;
  startedAt: string;
  userId?: string;  // Optional - will be required for authenticated sessions
}

export interface SaveBrainConfigInput {
  sessionId: string;
  targetUrl: string;
  weights: Record<string, number>;
  bias: number;
  source: 'start' | 'runtime' | 'finish' | 'crash';
}

export interface BrainState {
  bias: number;
  weights: Record<string, number>;
}

export interface SessionHistoryRecord {
  id: string;
  targetUrl: string;
  status: 'Running' | 'Completed' | 'Crashed';
  startedAt: string;
  finishedAt?: string;
  endedReason?: string;
  savedManually: boolean;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshots: number;
  runtimeMs?: number;
  coveragePercentage?: number;
  maxActions?: number;
  pagesVisited?: number;
}

export interface FindingRepository {
  createSession(input: CreateSessionInput): Promise<string>;
  markSessionCompleted(sessionId: string, finishedAt: string): Promise<void>;
  markSessionCrashed(sessionId: string, finishedAt: string, reason: string): Promise<void>;
  saveBrainConfig(input: SaveBrainConfigInput): Promise<string>;
  /**
   * Load the most recently captured brain (weights + bias) for a target URL,
   * used to warm-start the perceptron when re-testing the same site. Null if none.
   */
  loadLatestBrainConfig(targetUrl: string): Promise<BrainState | null>;
  markSessionSaved(sessionId: string): Promise<void>;
markLatestSessionSaved(targetUrl?: string): Promise<string | null>;
  /**
   * List session history with optional userId filtering for multi-tenancy.
   * @param limit - Maximum number of sessions to return (default 50)
   * @param userId - Optional userId to filter sessions (if provided, returns only user's sessions)
   */
  listSessionHistory(limit?: number, userId?: string): Promise<SessionHistoryRecord[]>;
}

import type { ActionBreadcrumb, TelemetryEvent } from '../../../../shared/types.ts';

export interface CreateSessionInput {
  targetUrl: string;
  startedAt: string;
  userId?: string;  // Optional - will be required for authenticated sessions
}

export interface SaveFindingInput {
  sessionId: string;
  event: TelemetryEvent;
}

export interface SaveActionTraceInput {
  sessionId: string;
  trace: ActionBreadcrumb;
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
}

/**
 * Bug finding output from the Domain layer.
 * Represents a confirmed bug that should be counted in exploration results.
 */
export interface BugFinding {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
}

export interface FindingRepository {
  createSession(input: CreateSessionInput): Promise<string>;
  markSessionCompleted(sessionId: string, finishedAt: string): Promise<void>;
  markSessionCrashed(sessionId: string, finishedAt: string, reason: string): Promise<void>;
  save(input: SaveFindingInput): Promise<string>;
  saveActionTrace(input: SaveActionTraceInput): Promise<string>;
  linkActionTracesToFinding(findingId: string, actionTraceIds: string[]): Promise<void>;
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
  /**
   * Collect bug findings for the most recent session associated with the target URL.
   * Applies proper domain filtering to return only actual bugs (EXCEPTION, RUNTIME_UI_FREEZE, SESSION_SYNC_FAULT, NETWORK with status >= 400).
   * This correctly belongs in the Domain layer per Clean Architecture.
   */
  collectBugFindings(targetUrl: string): Promise<BugFinding[]>;
}

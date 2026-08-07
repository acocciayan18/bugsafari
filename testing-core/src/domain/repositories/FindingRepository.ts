import type {
  InfiltrationProfileId,
  PaginationParams,
  RunTerminationOutcome,
  TestingTypeId,
} from '../../../../shared/types.js';

export interface CreateSessionInput {
  targetUrl: string;
  startedAt: string;
  userId?: string;  // Optional - will be required for authenticated sessions
  // Public RUN- code minted at run-start; stamped so live + history share one id. Schema default mints one when absent.
  runId?: string;
  // Run configuration, recorded so a finding can be traced back to the profile
  // that produced it. Derived from the gate, so it reflects what actually ran.
  infiltrationProfile?: InfiltrationProfileId;
  activeTestingTypes?: TestingTypeId[];
}

export interface SaveBrainConfigInput {
  sessionId: string;
  userId: string;
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
  /** Public RUN- code. Absent on legacy docs until the backfill assigns one. */
  runId?: string;
  targetUrl: string;
  status: 'Running' | 'Completed' | 'Crashed' | 'Stopped' | 'TimedOut' | 'Halted' | 'Abandoned' | 'EngineError';
  startedAt: string;
  finishedAt?: string;
  endedReason?: string;
  /** Precise termination taxonomy. Absent on sessions recorded before it was tracked. */
  outcome?: RunTerminationOutcome;
  /** Infiltration profile the run executed. Absent on sessions predating the field. */
  infiltrationProfile?: InfiltrationProfileId;
  savedManually: boolean;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshots: number;
  runtimeMs?: number;
  coveragePercentage?: number;
  maxActions?: number;
  pagesVisited?: number;
}

/**
 * Every mutation and brain read below takes the owning userId and MUST scope its
 * query by it — session documents and learned brains are tenant-private, so an id
 * alone is never sufficient authority to read or modify one.
 */
export interface FindingRepository {
  createSession(input: CreateSessionInput): Promise<string>;
  /**
   * Settle a session with its real termination outcome. Derives the coarse status
   * from `outcome` and records both the outcome and its operator-facing reason, so
   * history can tell a user stop from a timebox, crash, or abandonment.
   */
  markSessionTerminated(
    sessionId: string,
    userId: string,
    finishedAt: string,
    outcome: RunTerminationOutcome,
    reason: string,
  ): Promise<void>;
  saveBrainConfig(input: SaveBrainConfigInput): Promise<string>;
  /**
   * Load the most recently captured brain (weights + bias) this user captured for
   * a target URL, to warm-start the perceptron when re-testing the same site.
   * Scoped to the owner so learned models never cross accounts. Null if none.
   */
  loadLatestBrainConfig(targetUrl: string, userId: string): Promise<BrainState | null>;
  markSessionSaved(sessionId: string, userId: string): Promise<void>;
  markLatestSessionSaved(userId: string, targetUrl?: string): Promise<string | null>;
  /**
   * One page of saved session history, scoped to a tenant.
   * @param params - page/pageSize/skip; callers clamp via parsePagination
   * @param userId - owner filter; anything else (guest, malformed) yields an empty page
   */
  listSessionHistory(
    params: PaginationParams,
    userId?: string,
  ): Promise<{ items: SessionHistoryRecord[]; total: number }>;
}

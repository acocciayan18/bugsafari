import type {
  InfiltrationProfileId,
  PaginationParams,
  RunTerminationOutcome,
  SessionHistoryState,
  SeverityCounts,
  TestingTypeId,
} from '../../../../shared/types.js';
import type { ICaughtBug } from '../../infrastructure/database/models/SessionModel.js';

/** Persisted finding shape a checkpoint writes. Aliased so callers speak the domain's
 *  vocabulary while reusing the one schema-backed definition (as actionStepMapper does
 *  for ActionStepTrace) instead of duplicating a twenty-field interface. */
export type CheckpointFinding = ICaughtBug;

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
  // Operator-selected execution timebox (ms) for this run, recorded so history
  // reflects the duration the run was configured to explore for.
  executionTimeboxMs?: number;
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

// Authoritative run metrics the engine holds at terminal. Persisted so the history
// step count and forensic duration reflect the real run, not the capped/empty
// reproduction buffer the manual-save path samples.
export interface SessionTerminalStats {
  /** Real interactions executed this run (uncapped) — the history "N steps". */
  actionsExecuted: number;
  /** Paused-aware active runtime in ms — the forensic "Duration". */
  runtimeMs: number;
  /** Distinct pages visited. */
  pageCount: number;
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
  /** History bucket this row belongs to — drives the operator's Active/Archived/Trash view. */
  state: SessionHistoryState;
  findingCount: number;
  /** Real per-severity tally of this session's findings (ACCESSIBILITY excluded),
   *  resolved through the shared severity policy. Drives the History badge/filter;
   *  absent/empty when a legacy row stored no caughtBugs. */
  severityCounts?: SeverityCounts;
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
   * Mid-run checkpoint of the engine's confirmed-finding ledger onto the run's own
   * session document. The manual-save path used to be the only writer of
   * `forensicTrace.caughtBugs`, which made the browser's in-memory buffer the sole
   * author of the permanent report: a refresh, a dropped socket, or a worker kill
   * silently dropped findings the backend had already observed. Called repeatedly
   * and idempotently, so it replaces the array wholesale rather than appending.
   */
  checkpointFindings(
    sessionId: string,
    userId: string,
    bugs: CheckpointFinding[],
  ): Promise<void>;
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
    // Authoritative run metrics captured by the engine at terminal. Written here so
    // step count and duration populate for EVERY run — the manual-save path only sees a
    // capped/empty reproduction buffer (and never runs at all for an unsaved run).
    stats?: SessionTerminalStats,
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
   * @param state - history bucket to return (defaults to 'active')
   */
  listSessionHistory(
    params: PaginationParams,
    userId?: string,
    state?: SessionHistoryState,
  ): Promise<{ items: SessionHistoryRecord[]; total: number }>;
}

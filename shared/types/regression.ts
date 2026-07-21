// ═══════════════════════════════════════════════════════════════
// shared/types/regression.ts - AUTOMATED REGRESSION VERIFICATION CONTRACT
// ═══════════════════════════════════════════════════════════════
// Wire contract for the "Verify Fix" feature: the dashboard asks the engine to
// deterministically replay a previously-reported finding's recorded action
// timeline in a fresh Playwright session and report whether the bug still
// reproduces. Shared verbatim between the frontend hook and the backend socket
// handler so the request/response shape can never drift.

/** Terminal outcome of a regression replay. */
export type RegressionVerdict =
  | 'RESOLVED' // Replay executed the recorded steps; the original fault did NOT recur → fixed.
  | 'STILL_ACTIVE' // The original fault reproduced during replay → still broken.
  | 'INCONCLUSIVE' // Replay ran, but the evidence is insufficient to declare RESOLVED.
  | 'VERIFICATION_FAILED'; // Replay could not run (launch/nav/auth/infra error) — verdict says nothing about the bug.

/** Machine-readable cause behind a verdict, driving operator-facing explanations. */
export type VerifyFixReason =
  | 'REPRODUCED' // strong same-class signal recurred
  | 'CLEAN_REPLAY' // executed timeline, no recurrence
  | 'INSUFFICIENT_REPLAY' // too few recorded steps actually executed
  | 'FAULT_TRIGGER_NOT_EXERCISED' // replay never re-hit the request that defined the fault
  | 'UNVERIFIABLE_BUG_CLASS' // class has no replay-time detector
  | 'WEAK_MATCH_ONLY' // same-class faults seen but uncorroborated
  | 'LEGACY_TIMELINE' // session-global fallback timeline; clean run not provable
  | 'REPLAY_ERROR'; // infra failure, detail in `error`

/** Per-step execution evidence backing the verdict. */
export interface ReplayStepStats {
  total: number;
  executed: number;
  skipped: number;
  failed: number;
  /** True when the final (causal) recorded step actually executed. */
  finalStepExecuted: boolean;
}

/** Client → engine payload identifying the saved finding to verify. */
export interface VerifyFixRequest {
  /** Saved session (SafariSession) ObjectId that owns the finding. */
  sessionId: string;
  /** Stable bugId of the caughtBug inside that session's forensic trace. */
  bugId: string;
}

/**
 * Live phase of an in-flight regression replay. Streamed to the requesting client
 * so the Verify control can render a real progress flow (replaying → validating →
 * completed) instead of one opaque spinner. The terminal 'completed' phase is the
 * VerifyFixResult ack itself, so it is intentionally not part of this union.
 */
export type VerifyFixPhase = 'replaying' | 'validating';

/** Engine → client streamed progress for an in-flight VerifyFixRequest (fire-and-forget, no ack). */
export interface VerifyFixProgress {
  sessionId: string;
  bugId: string;
  phase: VerifyFixPhase;
  /** Recorded steps replayed so far; equals totalSteps once the phase is 'validating'. */
  stepsReplayed: number;
  /** Total recorded steps in the finding's timeline. */
  totalSteps: number;
}

/** A replay-observed fault that matched the original finding's classification. */
export interface RegressionSignal {
  /** Raw fault kind observed during replay. */
  faultType: 'EXCEPTION' | 'CONSOLE' | 'NETWORK' | 'FREEZE';
  /** Error/reason text (or the matched content excerpt). */
  message: string;
  /** HTTP status when the signal is a failed response. */
  statusCode?: number;
  /** Page/request URL at the time the signal fired. */
  url?: string;
}

/** Engine → client acknowledgement returned for a VerifyFixRequest. */
export interface VerifyFixResult {
  /** True when the replay ran to completion (false ⇔ verdict VERIFICATION_FAILED). */
  ok: boolean;
  verdict: RegressionVerdict;
  /** Why the verdict was reached; keys the operator-facing explanation. */
  reason: VerifyFixReason;
  sessionId: string;
  bugId: string;
  /** Knowledge-base BugClass of the ORIGINAL finding being re-checked. */
  bugClass: string;
  /** Number of recorded actions attempted (equals stepStats.total). */
  stepsReplayed: number;
  /** Executed/skipped/failed breakdown proving how much of the reproduction ran. */
  stepStats: ReplayStepStats;
  /** Replay-observed signals that matched the original bug (STILL_ACTIVE evidence). */
  matchedSignals: RegressionSignal[];
  /** Replay-observed faults of a DIFFERENT class — new findings, not reproduction evidence. */
  otherSignals: RegressionSignal[];
  /** 'finding' = per-finding minimized timeline; 'session' = legacy session-global fallback. */
  timelineSource: 'finding' | 'session';
  /** Operator-facing one-line summary of the outcome. */
  summary: string;
  /** Total replay wall-clock time in milliseconds. */
  durationMs: number;
  /** Populated when ok=false — why the replay could not conclude. */
  error?: string;
}

/** Socket.IO event name for a Verify Fix request (uses an ack callback for the result). */
export const VERIFY_FIX_EVENT = 'verify-fix' as const;

/** Socket.IO event name the engine emits to stream VerifyFixProgress during a replay. */
export const VERIFY_FIX_PROGRESS_EVENT = 'verify-fix:progress' as const;

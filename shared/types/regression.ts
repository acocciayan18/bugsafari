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
  | 'VERIFIED' // Replayed the recorded steps; the original fault did NOT recur → fixed.
  | 'BUG_PERSISTS' // The original fault class reproduced during replay → still broken.
  | 'INCONCLUSIVE'; // Could not run the replay (finding missing, auth failed, nav failed…).

/** Client → engine payload identifying the saved finding to verify. */
export interface VerifyFixRequest {
  /** Saved session (SafariSession) ObjectId that owns the finding. */
  sessionId: string;
  /** Stable bugId of the caughtBug inside that session's forensic trace. */
  bugId: string;
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
  /** True when the replay ran to completion (verdict is trustworthy). */
  ok: boolean;
  verdict: RegressionVerdict;
  sessionId: string;
  bugId: string;
  /** Knowledge-base BugClass of the ORIGINAL finding being re-checked. */
  bugClass: string;
  /** Number of recorded actions actually replayed. */
  stepsReplayed: number;
  /** Replay-observed signals that matched the original bug class (empty ⇒ VERIFIED). */
  matchedSignals: RegressionSignal[];
  /** Operator-facing one-line summary of the outcome. */
  summary: string;
  /** Total replay wall-clock time in milliseconds. */
  durationMs: number;
  /** Populated when ok=false — why the replay could not conclude. */
  error?: string;
}

/** Socket.IO event name for a Verify Fix request (uses an ack callback for the result). */
export const VERIFY_FIX_EVENT = 'verify-fix' as const;

// Pure verdict policy for Verify Fix — kept side-effect-free so it is unit-testable.
import type {
  RegressionSignal,
  RegressionVerdict,
  ReplayStepStats,
  VerifyFixReason,
} from '../../../../../shared/types.js';

// RESOLVED demands that at least this share of recorded steps actually executed.
export const MIN_EXECUTED_RATIO = 0.5;

export interface VerdictInput {
  strong: RegressionSignal[];
  weak: RegressionSignal[];
  stats: ReplayStepStats;
  timelineSource: 'finding' | 'session';
  /** Pathname of the request that defined the fault (network faults only); '' when N/A. */
  faultEndpoint?: string;
  /** Pathnames the replay actually requested — used to prove the fault trigger ran. */
  seenEndpoints?: string[];
  /** True when a page navigation aborted mid-replay — the faulting state may never have loaded. */
  replayIncomplete?: boolean;
}

export interface VerdictDecision {
  verdict: RegressionVerdict;
  reason: VerifyFixReason;
  /** Signals the operator should see as the verdict's evidence. */
  matchedSignals: RegressionSignal[];
}

/**
 * Ordering: reproduction is proof regardless of skips — a fault that recurs with
 * half the timeline skipped is still active. RESOLVED instead requires EVERY
 * gate: no weak same-class matches, a majority of steps executed, the final
 * (causal) step executed, and a per-finding timeline. Anything less is
 * INCONCLUSIVE with a reason, never a fabricated "fixed".
 */
export function decideVerdict(input: VerdictInput): VerdictDecision {
  const { strong, weak, stats, timelineSource } = input;
  // No recorded timeline ⇒ nothing was replayed. Any fault observed is a bare
  // page-load artifact that cannot be attributed to THIS finding, so it can never
  // prove STILL_ACTIVE (or RESOLVED) — the replay simply had nothing to do.
  if (stats.total === 0) {
    return { verdict: 'INCONCLUSIVE', reason: 'NO_REPLAY_STEPS', matchedSignals: [] };
  }
  if (strong.length > 0) return { verdict: 'STILL_ACTIVE', reason: 'REPRODUCED', matchedSignals: strong };
  if (weak.length > 0) return { verdict: 'INCONCLUSIVE', reason: 'WEAK_MATCH_ONLY', matchedSignals: weak };

  const ratio = stats.executed / stats.total;
  if (ratio < MIN_EXECUTED_RATIO || !stats.finalStepExecuted) {
    return { verdict: 'INCONCLUSIVE', reason: 'INSUFFICIENT_REPLAY', matchedSignals: [] };
  }
  // A fault defined by a specific request is only "resolved" if the replay actually
  // re-issued that request and it no longer faulted. If the recorded steps never hit
  // the endpoint, the failure condition was never re-tested — clean proves nothing.
  if (input.faultEndpoint && !(input.seenEndpoints ?? []).includes(input.faultEndpoint)) {
    return { verdict: 'INCONCLUSIVE', reason: 'FAULT_TRIGGER_NOT_EXERCISED', matchedSignals: [] };
  }
  if (timelineSource === 'session') {
    return { verdict: 'INCONCLUSIVE', reason: 'LEGACY_TIMELINE', matchedSignals: [] };
  }
  // A page navigation aborted mid-replay ⇒ the replay never reached the faulting page,
  // so the absence of the fault is not evidence of a fix. Never call it RESOLVED.
  if (input.replayIncomplete) {
    return { verdict: 'INCONCLUSIVE', reason: 'INCOMPLETE_REPLAY', matchedSignals: [] };
  }
  return { verdict: 'RESOLVED', reason: 'CLEAN_REPLAY', matchedSignals: [] };
}

/**
 * A would-be RESOLVED is only trusted when a second, independent replay also stays
 * clean — a single clean run is flaky against a live target (backend data/timing).
 * Reproduction on the retry flips to STILL_ACTIVE (a fault seen twice is proof it is
 * present); any non-clean or un-runnable retry means the fix could not be confirmed.
 * @param second the retry's verdict, or null when the retry could not run.
 */
export function confirmResolution(second: VerdictDecision | null): VerdictDecision {
  if (second && (second.verdict === 'STILL_ACTIVE' || second.verdict === 'RESOLVED')) return second;
  return { verdict: 'INCONCLUSIVE', reason: 'UNCONFIRMED_RESOLUTION', matchedSignals: [] };
}

/** Operator-facing one-liner for each decision, grounded in the actual evidence. */
export function summarize(decision: VerdictDecision, bugClass: string, stats: ReplayStepStats): string {
  switch (decision.reason) {
    case 'REPRODUCED':
      return `Bug still active: ${bugClass} reproduced after replaying ${stats.total} recorded step(s).`;
    case 'CLEAN_REPLAY':
      return `${stats.executed} of ${stats.total} recorded step(s) executed and no ${bugClass} fault recurred. Defect resolved.`;
    case 'WEAK_MATCH_ONLY':
      return `A same-class ${bugClass} fault recurred but could not be corroborated as the original defect — this leans still-active. Treat as unconfirmed, not fixed.`;
    case 'NO_REPLAY_STEPS':
      return `This finding has no recorded reproduction steps, so there was nothing to replay and no fault could be attributed to it. Re-run a live exploration to capture a replayable timeline.`;
    case 'UNCONFIRMED_RESOLUTION':
      return `The first replay came back clean, but a confirmation replay did not agree — the fault reproduces intermittently, so the fix cannot be confirmed. Re-test against a stable build.`;
    case 'INCOMPLETE_REPLAY':
      return `A page navigation aborted during replay, so the faulting page never fully loaded — a clean run can't prove the ${bugClass} defect is fixed. Re-test against a stable build.`;
    case 'INSUFFICIENT_REPLAY':
      return `Only ${stats.executed} of ${stats.total} recorded step(s) executed (${stats.skipped} skipped, ${stats.failed} failed) — not enough of the reproduction ran to prove the fix.`;
    case 'FAULT_TRIGGER_NOT_EXERCISED':
      return `The recorded steps replayed without re-triggering the request that produced the original ${bugClass} fault, so a clean run cannot prove it is fixed.`;
    case 'LEGACY_TIMELINE':
      return `Replay used the legacy session-wide timeline, which may never reach the faulting state; a clean run cannot prove this specific defect is fixed.`;
    default:
      return `Verification could not conclude for ${bugClass}.`;
  }
}

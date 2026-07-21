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
  if (strong.length > 0) return { verdict: 'STILL_ACTIVE', reason: 'REPRODUCED', matchedSignals: strong };
  if (weak.length > 0) return { verdict: 'INCONCLUSIVE', reason: 'WEAK_MATCH_ONLY', matchedSignals: weak };

  const ratio = stats.total > 0 ? stats.executed / stats.total : 0;
  if (stats.total === 0 || ratio < MIN_EXECUTED_RATIO || !stats.finalStepExecuted) {
    return { verdict: 'INCONCLUSIVE', reason: 'INSUFFICIENT_REPLAY', matchedSignals: [] };
  }
  if (timelineSource === 'session') {
    return { verdict: 'INCONCLUSIVE', reason: 'LEGACY_TIMELINE', matchedSignals: [] };
  }
  return { verdict: 'RESOLVED', reason: 'CLEAN_REPLAY', matchedSignals: [] };
}

/** Operator-facing one-liner for each decision, grounded in the actual evidence. */
export function summarize(decision: VerdictDecision, bugClass: string, stats: ReplayStepStats): string {
  switch (decision.reason) {
    case 'REPRODUCED':
      return `Bug still active: ${bugClass} reproduced after replaying ${stats.total} recorded step(s).`;
    case 'CLEAN_REPLAY':
      return `All ${stats.executed} of ${stats.total} recorded step(s) executed and no ${bugClass} fault recurred. Defect resolved.`;
    case 'WEAK_MATCH_ONLY':
      return `Faults of the same class (${bugClass}) occurred but could not be corroborated as the original defect. Not enough evidence to call it resolved.`;
    case 'INSUFFICIENT_REPLAY':
      return `Only ${stats.executed} of ${stats.total} recorded step(s) executed (${stats.skipped} skipped, ${stats.failed} failed) — not enough of the reproduction ran to prove the fix.`;
    case 'LEGACY_TIMELINE':
      return `Replay used the legacy session-wide timeline, which may never reach the faulting state; a clean run cannot prove this specific defect is fixed.`;
    default:
      return `Verification could not conclude for ${bugClass}.`;
  }
}

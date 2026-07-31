// ═══════════════════════════════════════════════════════════════
// verification/confidenceScore.ts — EVIDENCE SCORING (pure)
// ═══════════════════════════════════════════════════════════════
// Maps a candidate finding's evidence signals onto a normalized 0–1 confidence
// score and a terminal VerificationStatus. Deterministic: identical evidence
// always yields an identical verdict. The score is intentionally conservative —
// a lone, low-evidence fault lands in NEEDS_VERIFICATION/INCONCLUSIVE rather than
// being reported as a confirmed bug.

import type { FaultConfidence, FaultOrigin, VerificationStatus } from '../../../../../shared/types.js';

export interface ScoreInput {
  confidence: FaultConfidence;
  origin: FaultOrigin;
  /** Evidence completeness 0–1 (fraction of expected evidence fields present). */
  evidenceCompleteness: number;
  /** A repeat occurrence or a second channel independently corroborated the fault. */
  corroborated: boolean;
  /** A deterministic reproduction pass re-observed the fault (optional; unknown ⇒ undefined). */
  reproduced?: boolean;
}

export interface ScoreResult {
  score: number;
  status: VerificationStatus;
}

const CONFIDENCE_BASE: Record<FaultConfidence, number> = {
  CONFIRMED: 0.85, // oracle positively corroborated (payload executed/reflected)
  SIGNAL: 0.6, // a runtime signal signature matched
  INFERRED: 0.3, // no signal — resolved from scenario/fault-type default only
};

const CONFIRMED_THRESHOLD = 0.8;
const NEEDS_VERIFICATION_THRESHOLD = 0.5;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Compute the confidence score and terminal status for a candidate finding.
 *   score ≥ 0.8            → CONFIRMED
 *   0.5 ≤ score < 0.8      → NEEDS_VERIFICATION
 *   score < 0.5            → INCONCLUSIVE
 * A non-target-app origin (other than UNKNOWN) can never be CONFIRMED, and an
 * UNKNOWN origin is capped at NEEDS_VERIFICATION until corroborated.
 */
export function scoreFinding(input: ScoreInput): ScoreResult {
  let score = CONFIDENCE_BASE[input.confidence];

  if (input.origin === 'TARGET_APP') score += 0.1;
  else if (input.origin === 'UNKNOWN') score -= 0.2;
  else score -= 0.5; // an identified artifact origin should never read as a strong defect

  if (input.corroborated) score += 0.15;
  if (input.reproduced === true) score += REPRODUCED_BONUS;
  if (input.reproduced === false) score -= NOT_REPRODUCED_PENALTY;

  score += 0.1 * clamp01(input.evidenceCompleteness);

  return gradeScore(score, input.origin);
}

/** Weight of an in-run reproduction pass — applied at scoring time or retroactively. */
export const REPRODUCED_BONUS = 0.15;
/** Ran a repro pass and the fault did NOT recur. Deliberately milder than the bonus:
 *  a non-reproducing replay is weaker evidence of absence than a reproducing one is
 *  of presence (timing, state, and one-shot faults all replay clean). */
export const NOT_REPRODUCED_PENALTY = 0.1;

/**
 * Re-grade an already-scored finding once its reproduction pass settles. Applies the
 * SAME delta scoreFinding would have used, so an in-run verdict and a hypothetical
 * up-front one converge on the identical score.
 *
 * When `rate` (reproductions / decidable attempts, 0–1) is supplied the delta scales
 * with it: a deterministic bug (rate 1) earns the full bonus, a flake earns a
 * proportional partial bonus, and a bug that never recurred (rate 0) takes the
 * penalty. Omitting `rate` preserves the exact single-shot boolean behaviour, so
 * legacy callers and rate∈{0,1} converge on the identical score.
 */
export function applyReproductionOutcome(
  score: number,
  origin: FaultOrigin,
  reproduced: boolean,
  rate?: number,
): ScoreResult {
  const delta =
    rate === undefined
      ? reproduced
        ? REPRODUCED_BONUS
        : -NOT_REPRODUCED_PENALTY
      : rate > 0
        ? REPRODUCED_BONUS * clamp01(rate)
        : -NOT_REPRODUCED_PENALTY;
  return gradeScore(score + delta, origin);
}

/** Clamp, threshold, and apply the origin caps. Single source of the verdict bands. */
function gradeScore(raw: number, origin: FaultOrigin): ScoreResult {
  const score = clamp01(raw);

  let status: VerificationStatus;
  if (score >= CONFIRMED_THRESHOLD) status = 'CONFIRMED';
  else if (score >= NEEDS_VERIFICATION_THRESHOLD) status = 'NEEDS_VERIFICATION';
  else status = 'INCONCLUSIVE';

  // Hard caps: only a target-app fault may be CONFIRMED; an unattributed one needs a pass.
  if (status === 'CONFIRMED' && origin !== 'TARGET_APP') status = 'NEEDS_VERIFICATION';

  return { score: Math.round(score * 100) / 100, status };
}

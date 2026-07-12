/**
 * Adaptive stagnation scoring (compound-hash aware), extracted from
 * ExplorationLoop.execute() as pure functions so the formula is unit-testable
 * in isolation from Page/telemetry/pathNavigator collaborators.
 *
 * Instead of a binary "3 identical hashes → punish" cliff, stagnation is scored
 * progressively from two signals of the compound fingerprint:
 *   • combinedRepeated     — the exact state (structure + interactive) recurred.
 *   • structureFamiliarity — how often this structural SHELL appeared in the
 *                            recent short-term window (same layout, possibly
 *                            different data).
 * A coverage-stall term adds pressure independent of hash repetition.
 */

export interface StagnationInputs {
  currentHash: string;
  previousCombined: string;
  recentStructures: readonly string[];
  structure: string;
  structureWindow: number;
  coverageStagnant: boolean;
  /**
   * Steps the run has churned BEYOND the coverage-stall window without any new
   * coverage (0 at the threshold). Escalates the coverage term so a deep, sustained
   * stall forces a longer escape window / earlier backtrack than one that just
   * crossed the line. Optional: omitted ⇒ the original binary +1 behavior.
   */
  coverageStallSteps?: number;
}

/** Steps beyond the stall window that add one extra coverage-pressure point. */
export const COVERAGE_STALL_STEP = 3;
/** Bound on the extra coverage-pressure points so the escape window always recovers. */
export const COVERAGE_STALL_CAP = 3;

export interface StagnationResult {
  combinedRepeated: boolean;
  structureFamiliarity: number;
  stagnationScore: number;
  nextRecentStructures: string[];
  nextPreviousCombined: string;
}

export function computeStagnation(inputs: StagnationInputs): StagnationResult {
  const {
    currentHash,
    previousCombined,
    recentStructures,
    structure,
    structureWindow,
    coverageStagnant,
    coverageStallSteps,
  } = inputs;

  const combinedRepeated = currentHash === previousCombined;
  const structureFamiliarity = recentStructures.filter((s) => s === structure).length;

  const nextRecentStructures = [...recentStructures, structure];
  if (nextRecentStructures.length > structureWindow) nextRecentStructures.shift();

  // Coverage term: the baseline +1 at the stall threshold, escalated by one point
  // per COVERAGE_STALL_STEP steps of sustained no-coverage churn (bounded by the
  // cap). Omitting coverageStallSteps reproduces the original binary behavior.
  const extraStall = coverageStagnant
    ? Math.min(COVERAGE_STALL_CAP, Math.floor(Math.max(0, coverageStallSteps ?? 0) / COVERAGE_STALL_STEP))
    : 0;
  const coverageStagnation = coverageStagnant ? 1 + extraStall : 0;
  const stagnationScore = (combinedRepeated ? 2 : 0) + structureFamiliarity + coverageStagnation;

  return {
    combinedRepeated,
    structureFamiliarity,
    stagnationScore,
    nextRecentStructures,
    nextPreviousCombined: currentHash,
  };
}

/** Scales the per-element penalty applied while an escape window is open. */
export function computePenaltyIntensity(stagnationScore: number, forceBacktrackThreshold: number): number {
  return Math.min(1, (stagnationScore - 1) / forceBacktrackThreshold);
}

/** Length (in steps) of the escape window opened by a stagnation penalty, capped so it always recovers. */
export function computePenaltyWindow(stagnationScore: number, cap = 6): number {
  return Math.min(cap, stagnationScore + 1);
}

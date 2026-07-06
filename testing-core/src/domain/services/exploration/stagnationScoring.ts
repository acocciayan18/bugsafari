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
}

export interface StagnationResult {
  combinedRepeated: boolean;
  structureFamiliarity: number;
  stagnationScore: number;
  nextRecentStructures: string[];
  nextPreviousCombined: string;
}

export function computeStagnation(inputs: StagnationInputs): StagnationResult {
  const { currentHash, previousCombined, recentStructures, structure, structureWindow, coverageStagnant } = inputs;

  const combinedRepeated = currentHash === previousCombined;
  const structureFamiliarity = recentStructures.filter((s) => s === structure).length;

  const nextRecentStructures = [...recentStructures, structure];
  if (nextRecentStructures.length > structureWindow) nextRecentStructures.shift();

  const coverageStagnation = coverageStagnant ? 1 : 0;
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

/**
 * Pure novelty-reward decision, extracted from ExplorationLoop so the rule is
 * unit-testable in isolation from Page/perceptron collaborators.
 *
 * The engine formerly rewarded any traversal whose COMBINED child hash was
 * unseen. On ad-heavy or crashing pages the combined hash (which folds in
 * volatile interactive labels) differs on every reload, so re-clicking one
 * control that merely reloads the same page read as an endless stream of "novel"
 * states — a false-novelty reward loop that pinned exploration on a single
 * button and never advanced.
 *
 * Novelty is now gated on the STRUCTURE sub-hash: a genuinely new layout shell
 * means a new region of the app worth rewarding, whereas a repeated shell (same
 * page reloaded, only volatile content changed) is not. Graph node/edge identity
 * still uses the finer-grained combined hash — only the learning reward changes.
 */

export interface NoveltyInputs {
  /** The click produced a verified new state (not a no-op / unstable edge). */
  traversalOk: boolean;
  /** The click drove the page into an invalid context (about:blank / crash-error). */
  landedInvalid: boolean;
  /** Structure sub-hash of the state the click actually produced. */
  childStructure: string;
  /** Structure sub-hashes observed so far this run. */
  visitedStructures: ReadonlySet<string>;
}

/**
 * True only when a verified traversal reached a structurally NEW shell. A no-op
 * traversal, an invalid-context landing, or a return to an already-seen shell all
 * yield false, so the perceptron is never rewarded for reproducing a seen state.
 */
export function isNovelStructuralState(inputs: NoveltyInputs): boolean {
  const { traversalOk, landedInvalid, childStructure, visitedStructures } = inputs;
  if (!traversalOk || landedInvalid) return false;
  return !visitedStructures.has(childStructure);
}

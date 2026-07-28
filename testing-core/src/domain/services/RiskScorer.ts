import type { SemanticRole } from '@bugsafari/shared';
import type { ParsedElement } from '../heuristics/domParser.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import {
  SingleLayerPerceptron,
  buildFeatureVectorFromElement,
  wordBoundaryMatch,
  type RewardSignals,
} from '../../ml/perceptron.js';
import type { FeatureVector } from '../../types.js';

/**
 * Unified RiskScorer combining:
 * - Heuristic scoring (keyword weights, semantic roles, layout scoring)
 * - ML scoring (perceptron model)
 * 
 * Final score = heuristicScore * 0.6 + mlScore * 0.4
 */

// ============ HEURISTIC WEIGHTS ============

const TAG_WEIGHTS = new Map<string, number>([
  ['button', 18],
  ['input', 18],
  ['textarea', 16],
  ['select', 12],
  ['a', 8],
]);

const TYPE_WEIGHTS = new Map<string, number>([
  ['password', 42],
  ['email', 34],
  ['search', 28],
  ['text', 26],
  ['number', 22],
  ['submit', 30],
  ['button', 18],
]);

const KEYWORD_WEIGHTS = new Map<string, number>([
  ['submit', 54],
  ['login', 82],
  ['sign in', 76],
  ['auth', 70],
  ['checkout', 74],
  ['pay', 78],
  ['register', 58],
  ['email', 50],
  ['delete', 86],
  ['remove', 70],
  ['destroy', 92],
  ['save', 44],
  ['create', 40],
  ['search', 36],
  ['next', 28],
  ['continue', 34],
]);

// ============ INTERFACES ============

export interface ScoredElement extends ParsedElement {
  score: number;
  isVisible: boolean;
  semanticRole: SemanticRole;
  heuristicScore: number;
  mlScore: number;
}

// ============ MAIN CLASS ============

// Look-Ahead Edge Suppression: fixed floor subtracted from any control whose
// navigation destination is already fully saturated, so it sinks below every
// eligible control and is never selected. Large enough to beat any keyword sum
// yet finite (no NaN/Infinity in downstream telemetry .toFixed()).
const SATURATED_DESTINATION_FLOOR = 1_000_000;

// Keeps heuristicScore on the same 0-100 scale as mlScore (sigmoid-bounded) so stacked keyword matches can't dominate combinedScore.
const HEURISTIC_SCORE_CAP = 100;

// Below this the score is LINEAR — identical to the previous hard-cap behaviour for
// the great majority of elements, so ranking is not perturbed. Only the saturation
// zone above it is compressed.
const HEURISTIC_LINEAR_LIMIT = 80;

/**
 * Bound the heuristic score without creating ties (audit P3-19).
 *
 * Clamping at 100 made any element matching two strong keywords saturate and TIE,
 * handing the decision to the pathfinder's positional tie-breaker on exactly the
 * controls the heuristic cares most about. An asymptotic tail keeps the ordering
 * strict all the way up while never exceeding the cap — and leaves everything below
 * HEURISTIC_LINEAR_LIMIT scored exactly as before, so this fixes the ties without
 * quietly re-weighting the heuristic-vs-ML blend for ordinary controls.
 */
function squashToCap(raw: number): number {
  if (raw <= HEURISTIC_LINEAR_LIMIT) return raw;
  const headroom = HEURISTIC_SCORE_CAP - HEURISTIC_LINEAR_LIMIT;
  return HEURISTIC_LINEAR_LIMIT + headroom * (1 - Math.exp(-(raw - HEURISTIC_LINEAR_LIMIT) / headroom));
}

export class RiskScorer {
  private readonly perceptron = new SingleLayerPerceptron();
  private readonly penalties = new Map<string, number>();
  // Structural shell the current ranking pass belongs to. Penalties are keyed by
  // (shell, selector) because a CSS selector is not a globally unique control
  // identity (audit P3-07) — `#email` on login and `#email` on profile-edit are
  // different controls, and a positional path repeats verbatim across every
  // instance of one template. Without the shell, penalising one namesake sank all
  // of them. Empty string = unscoped (backward compatible for direct callers).
  private scope = '';
  // Selectors whose look-ahead navigation destination is a saturated state.
  // Refreshed by the loop each ranking pass from the navigator's graph memory;
  // scored to the floor so they are ineligible without mutating graph edges.
  private suppressedSelectors: ReadonlySet<string> = new Set();

  // Weight combination ratio (0.6 heuristics, 0.4 ML)
  private readonly heuristicWeight = 0.6;
  private readonly mlWeight = 0.4;

  // Penalty lifecycle (audit A1): penalties were once only incremented, never
  // decayed, so a single stagnation event (which penalizes every ranked element)
  // drove the whole frontier permanently negative and forced premature "graph
  // exhausted". Penalties are now transient — bounded per-call + in aggregate,
  // and decayed once per ranking pass so a nudge fades over ~10–20 steps.
  private static readonly PENALTY_DECAY = 0.9;
  private static readonly PENALTY_EPSILON = 0.5;
  private static readonly PENALTY_CALL_CAP = 60;
  private static readonly PENALTY_ACCUMULATION_CAP = 200;

  /**
   * Score elements for InteractiveElement[] (used by AutonomousExplorationEngine)
   */
  score(elements: InteractiveElement[]): InteractiveElement[] {
    const scored = elements.map((element) => {
      const featureVector = buildFeatureVectorFromElement({
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        type: element.type,
        text: element.innerText,
        disabled: element.isDisabled ?? false,
        boundingBox: element.boundingBox,
        placeholder: element.placeholder ?? '',
        ariaLabel: element.ariaLabel ?? '',
        role: element.role ?? '',
        name: element.name ?? '',
        opensLayer: element.opensLayer ?? false,
      });

      // Compute ML score using perceptron
      const mlScore = this.perceptron.sigmoidScore(featureVector) * 100;
      
      // Compute heuristic score from keyword weights
      const heuristicScore = this.computeHeuristicFromFeatures(element);
      
      // Combine scores with weighted formula: 60% heuristic + 40% ML
      const combinedScore = heuristicScore * this.heuristicWeight + mlScore * this.mlWeight;
      
      const penalty = this.penalties.get(this.penaltyKey(element.selector)) ?? 0;
      // Look-ahead suppression: a control navigating to an already-saturated
      // destination is floored so it is never picked over an eligible control.
      const suppression = this.suppressedSelectors.has(element.selector) ? SATURATED_DESTINATION_FLOOR : 0;

      return {
        ...element,
        featureVector,
        riskScore: combinedScore - penalty - suppression,
      };
    });

    return scored.sort((left, right) => right.riskScore - left.riskScore);
  }

  /**
   * Compute heuristic score from element features (keyword-based)
   */
  private computeHeuristicFromFeatures(element: InteractiveElement): number {
    let score = 8;
    // Scan the SAME label surface the perceptron feature vector reads (placeholder /
    // aria-label / name / role), not just id+class+text — otherwise an icon button
    // whose only signal is aria-label="Delete" or an input whose keyword lives in
    // its placeholder is under-scored heuristically while the ML model sees it.
    // className is deliberately EXCLUDED (audit P3-19): utility classes are not
    // human-facing labels, and substring matching over them inflated every element
    // ('search-bar' → +36, 'payment-panel' → +78, 'save-icon' → +44).
    const text = `${element.id} ${element.innerText} ${element.type} ${element.placeholder ?? ''} ${element.ariaLabel ?? ''} ${element.name ?? ''} ${element.role ?? ''}`.toLowerCase();

    // Tag weights
    score += TAG_WEIGHTS.get(element.tagName.toLowerCase()) ?? 4;

    // Type weights
    score += TYPE_WEIGHTS.get(element.type.toLowerCase()) ?? 0;

    // Keyword weights. Word-boundary matched (the same rule the perceptron's own
    // keyword extraction uses) so 'login' cannot fire on 'blogger'.
    let keywordScore = 0;
    for (const [keyword, weight] of KEYWORD_WEIGHTS.entries()) {
      if (wordBoundaryMatch(text, keyword)) {
        keywordScore += weight;
      }
    }

    return squashToCap(score + keywordScore);
  }

  /**
   * Set the look-ahead suppression set — selectors whose navigation destination
   * is a fully saturated state. The loop refreshes this from the navigator's
   * per-selector destination memory before each ranking pass.
   */
  setSuppressedSelectors(selectors: ReadonlySet<string>): void {
    this.suppressedSelectors = selectors;
  }

  /**
   * Strong contrastive perceptron update for a transition that landed on a
   * saturated destination — trains the model to steer away from controls that
   * lead into already-exhausted regions.
   */
  penalizeSaturatedTransition(element: InteractiveElement): void {
    this.applyCompoundReward(element, { saturatedDestination: true });
  }

  /**
   * Penalize an element selector (escape mode / no-op / route-exhaustion). Both
   * the per-call magnitude and the accumulated total are capped so one event can
   * deprioritize a control without driving its score permanently negative.
   */
  penalize(selector: string, magnitude = 1): void {
    const key = this.penaltyKey(selector);
    const capped = Math.min(Math.abs(magnitude), RiskScorer.PENALTY_CALL_CAP);
    const current = this.penalties.get(key) ?? 0;
    this.penalties.set(key, Math.min(current + capped, RiskScorer.PENALTY_ACCUMULATION_CAP));
  }

  /**
   * Bind subsequent scoring/penalty bookkeeping to a structural shell, so the same
   * selector on two different screens is two different controls. Called once per
   * ranking pass by the exploration loop.
   */
  setScope(structureHash: string): void {
    this.scope = structureHash ?? '';
  }

  private penaltyKey(selector: string): string {
    return `${this.scope}::${selector}`;
  }

  /**
   * Decay all accumulated penalties one step (multiplicative), dropping any that
   * fade below epsilon. Called once per ranking pass by the exploration loop so a
   * penalty is a transient nudge, not permanent score suppression.
   */
  decayPenalties(): void {
    for (const [selector, value] of this.penalties) {
      const next = value * RiskScorer.PENALTY_DECAY;
      if (next < RiskScorer.PENALTY_EPSILON) {
        this.penalties.delete(selector);
      } else {
        this.penalties.set(selector, next);
      }
    }
  }

  /**
   * Update the perceptron from compound learning signals (structural change,
   * network activity, fault detection, revisit). Robust to elements whose
   * feature vector was never computed (unranked) — no-op in that case.
   */
  applyCompoundReward(element: InteractiveElement, signals: RewardSignals): void {
    if (element.featureVector) {
      this.perceptron.applyReward(element.featureVector, signals);
    }
  }

  /**
   * Boost perceptron from network signal (back-compat wrapper → compound reward).
   */
  rewardFromNetworkSignal(element: InteractiveElement): void {
    this.applyCompoundReward(element, { networkActivity: true });
  }

  /**
   * Penalize perceptron for a revisited (non-novel) state — contrastive signal.
   */
  penalizeRevisit(element: InteractiveElement): void {
    this.applyCompoundReward(element, { revisit: true });
  }

  /**
   * Penalize perceptron for a no-op action — a control that produced no structural
   * change at all. Milder than a revisit: the control is dead, not looping.
   */
  penalizeNoOp(element: InteractiveElement): void {
    this.applyCompoundReward(element, { noOp: true });
  }

  /**
   * Bounded ML confidence (0–1) for an element's feature vector — exposed as a
   * learning metric for telemetry. Returns 0 when features are unavailable.
   */
  getConfidence(vector: FeatureVector | undefined): number {
    return vector ? this.perceptron.sigmoidScore(vector) : 0;
  }

  /**
   * Export brain state for persistence
   */
  exportBrainState(): { bias: number; weights: Record<string, number> } {
    return {
      bias: this.perceptron.getBias(),
      weights: this.perceptron.exportWeights(),
    };
  }

  /**
   * Seed the perceptron from a persisted brain (per-URL warm-start)
   */
  importBrainState(state: { bias: number; weights: Record<string, number> }): void {
    this.perceptron.loadState(state.weights, state.bias);
  }

}

import type { SemanticRole } from '@bugsafari/shared';
import type { ParsedElement } from '../heuristics/domParser.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import {
  SingleLayerPerceptron,
  buildFeatureVectorFromElement,
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

export class RiskScorer {
  private readonly perceptron = new SingleLayerPerceptron();
  private readonly penalties = new Map<string, number>();

  // Weight combination ratio (0.6 heuristics, 0.4 ML)
  private readonly heuristicWeight = 0.6;
  private readonly mlWeight = 0.4;

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
        disabled: false,
        boundingBox: element.boundingBox,
        placeholder: element.placeholder ?? '',
        ariaLabel: element.ariaLabel ?? '',
        role: element.role ?? '',
        name: element.name ?? '',
      });

      // Compute ML score using perceptron
      const mlScore = this.perceptron.sigmoidScore(featureVector) * 100;
      
      // Compute heuristic score from keyword weights
      const heuristicScore = this.computeHeuristicFromFeatures(element);
      
      // Combine scores with weighted formula: 60% heuristic + 40% ML
      const combinedScore = heuristicScore * this.heuristicWeight + mlScore * this.mlWeight;
      
      const penalty = this.penalties.get(element.selector) ?? 0;
      
      return {
        ...element,
        featureVector,
        riskScore: combinedScore - penalty,
      };
    });

    return scored.sort((left, right) => right.riskScore - left.riskScore);
  }

  /**
   * Compute heuristic score from element features (keyword-based)
   */
  private computeHeuristicFromFeatures(element: InteractiveElement): number {
    let score = 8;
    const text = `${element.id} ${element.className} ${element.innerText} ${element.type}`.toLowerCase();
    
    // Tag weights
    score += TAG_WEIGHTS.get(element.tagName.toLowerCase()) ?? 4;
    
    // Type weights
    score += TYPE_WEIGHTS.get(element.type.toLowerCase()) ?? 0;
    
    // Keyword weights
    for (const [keyword, weight] of KEYWORD_WEIGHTS.entries()) {
      if (text.includes(keyword)) {
        score += weight;
      }
    }
    
    return score;
  }

  /**
   * Penalize element selector (used for escape mode)
   */
  penalize(selector: string, magnitude = 1): void {
    const current = this.penalties.get(selector) ?? 0;
    this.penalties.set(selector, current + magnitude);
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

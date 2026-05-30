import type { Page } from 'playwright';
import type { SemanticRole } from '../../contracts.js';
import type { MemoryTracker } from '../../ml/domHasher.js';
import type { ParsedElement } from '../heuristics/domParser.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import { SingleLayerPerceptron, buildFeatureVectorFromElement } from '../../ml/perceptron.js';

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

export interface ActionFeedback {
  networkTriggered: boolean;
  routeChanged: boolean;
  highLatency: boolean;
  causedException: boolean;
}

// ============ MAIN CLASS ============

export class RiskScorer {
  private readonly perceptron = new SingleLayerPerceptron();
  private readonly adaptiveWeights = new Map<string, number>();
  private readonly penalties = new Map<string, number>();

  // Weight combination ratio (0.6 heuristics, 0.4 ML)
  private readonly heuristicWeight = 0.6;
  private readonly mlWeight = 0.4;

  /**
   * Score elements using the unified scoring approach
   * Combines heuristic scoring + ML perceptron scoring
   */
  async scoreElements(
    page: Page,
    elements: ParsedElement[],
    memory: MemoryTracker,
    stateVisitCount: number,
  ): Promise<ScoredElement[]> {
    const scored: ScoredElement[] = [];

    for (const element of elements.slice(0, 120)) {
      const locator = page.locator(element.selector).first();
      const isVisible = await locator.isVisible().catch(() => false);
      const semanticRole = classifySemanticRole(element);

      if (!isVisible) {
        scored.push({ ...element, score: 0, isVisible, semanticRole, heuristicScore: 0, mlScore: 0 });
        continue;
      }

      // Compute heuristic score
      const heuristicScore = this.computeHeuristicScore(element, semanticRole);
      
      // Compute ML score using perceptron
      const featureVector = buildFeatureVectorFromElement({
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        type: element.type,
        text: element.text,
        disabled: element.isDisabled,
      });
      const mlScore = this.perceptron.sigmoidScore(featureVector) * 100;
      
      // Apply adaptive and penalty adjustments
      const adaptiveScore = this.adaptiveWeights.get(element.featureSignature) ?? 0;
      const repeatPenalty = stateVisitCount > 1 ? stateVisitCount * 10 : 0;
      const actionPenalty = memory.getActionPenalty(element.featureSignature);
      const layoutScore = computeLayoutScore(element);
      const constraintScore = element.isDisabled ? 20 : 0;
      
      // Combine scores with weighted formula
      const baseHeuristic = heuristicScore + layoutScore + constraintScore;
      const baseML = mlScore;
      
      const combinedScore = Math.max(
        1,
        Math.round(
          (baseHeuristic * this.heuristicWeight + baseML * this.mlWeight) +
          adaptiveScore -
          repeatPenalty -
          actionPenalty
        ),
      );

      scored.push({ 
        ...element, 
        score: combinedScore, 
        isVisible, 
        semanticRole,
        heuristicScore: baseHeuristic,
        mlScore: baseML,
      });
    }

    return scored.filter((element) => element.score > 0).sort((a, b) => b.score - a.score);
  }

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
   * Apply feedback to adjust adaptive weights
   */
  applyFeedback(element: ScoredElement, feedback: ActionFeedback): number {
    const previousWeight = this.adaptiveWeights.get(element.featureSignature) ?? 0;
    const delta =
      (feedback.networkTriggered ? 24 : 0) +
      (feedback.routeChanged ? 22 : 0) +
      (feedback.highLatency ? 16 : 0) -
      (feedback.causedException ? 8 : 0);
    const nextWeight = Math.max(-30, Math.min(160, previousWeight + delta));

    this.adaptiveWeights.set(element.featureSignature, nextWeight);
    return nextWeight;
  }

  /**
   * Penalize element selector (used for escape mode)
   */
  penalize(selector: string, magnitude = 1): void {
    const current = this.penalties.get(selector) ?? 0;
    this.penalties.set(selector, current + magnitude);
  }

  /**
   * Boost perceptron from network signal
   */
  rewardFromNetworkSignal(element: InteractiveElement): void {
    if (element.featureVector) {
      this.perceptron.boostFromNetworkSignal(element.featureVector);
    }
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

  // ============ PRIVATE HELPER METHODS ============

  private computeHeuristicScore(element: ParsedElement, semanticRole: SemanticRole): number {
    const clues = collectClues(element);
    let score = 8;

    score += TAG_WEIGHTS.get(element.tagName) ?? 4;
    score += TYPE_WEIGHTS.get(element.type.toLowerCase()) ?? 0;

    for (const [keyword, weight] of KEYWORD_WEIGHTS.entries()) {
      if (clues.includes(keyword)) {
        score += weight;
      }
    }

    if (semanticRole === 'LOGIN' || semanticRole === 'DESTRUCTIVE') {
      score += 30;
    }

    if (semanticRole === 'SUBMIT') {
      score += 18;
    }

    if (element.role === 'button') {
      score += 12;
    }

    return score;
  }
}

// ============ HELPER FUNCTIONS ============

export function classifySemanticRole(element: ParsedElement): SemanticRole {
  const clues = collectClues(element);

  if (/(login|log in|sign in|auth|password)/.test(clues)) {
    return 'LOGIN';
  }

  if (/(search|find|query)/.test(clues)) {
    return 'SEARCH';
  }

  if (/(delete|remove|clear|destroy|drop|wipe)/.test(clues)) {
    return 'DESTRUCTIVE';
  }

  if (/(submit|save|next|continue|add|create|checkout|pay|register)/.test(clues)) {
    return 'SUBMIT';
  }

  if (/(cancel|back|close|exit|dismiss)/.test(clues)) {
    return 'CANCEL';
  }

  if (element.tagName === 'a' || element.role === 'link') {
    return 'NAVIGATE';
  }

  if (['input', 'textarea', 'select'].includes(element.tagName)) {
    return 'INPUT';
  }

  return 'UNKNOWN';
}

function collectClues(element: ParsedElement): string {
  return [
    element.tagName,
    element.id,
    element.className,
    element.type,
    element.name,
    element.text,
    element.role,
    element.href,
  ]
    .join(' ')
    .toLowerCase();
}

function computeLayoutScore(element: ParsedElement): number {
  const { width, height, y } = element.boundingBox;
  const area = width * height;
  const areaScore = Math.min(20, area / 1500);
  const viewportPriority = y >= 0 && y <= 900 ? 8 : 0;

  return areaScore + viewportPriority;
}

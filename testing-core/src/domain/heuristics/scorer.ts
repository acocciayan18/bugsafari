import type { Page } from 'playwright';
import type { SemanticRole } from '../../contracts.js';
import type { MemoryTracker } from './hashUtils.js';
import type { ParsedElement } from './domParser.js';

export interface ScoredElement extends ParsedElement {
  score: number;
  isVisible: boolean;
  semanticRole: SemanticRole;
}

export interface ActionFeedback {
  networkTriggered: boolean;
  routeChanged: boolean;
  highLatency: boolean;
  causedException: boolean;
}

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

export class RiskScorer {
  private readonly adaptiveWeights = new Map<string, number>();

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
        scored.push({ ...element, score: 0, isVisible, semanticRole });
        continue;
      }

      const featureScore = this.computeFeatureScore(element, semanticRole);
      const adaptiveScore = this.adaptiveWeights.get(element.featureSignature) ?? 0;
      const repeatPenalty = stateVisitCount > 1 ? stateVisitCount * 10 : 0;
      const actionPenalty = memory.getActionPenalty(element.featureSignature);
      const layoutScore = computeLayoutScore(element);
      const constraintScore = element.isDisabled ? 20 : 0;
      const score = Math.max(
        1,
        Math.round(featureScore + adaptiveScore + layoutScore + constraintScore - repeatPenalty - actionPenalty),
      );

      scored.push({ ...element, score, isVisible, semanticRole });
    }

    return scored.filter((element) => element.score > 0).sort((a, b) => b.score - a.score);
  }

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

  private computeFeatureScore(element: ParsedElement, semanticRole: SemanticRole): number {
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

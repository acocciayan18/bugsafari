import { SingleLayerPerceptron, buildFeatureVectorFromElement } from '../../ml/perceptron.js';
import type { InteractiveElement } from '../entities/InteractiveElement.js';

export class ElementScorer {
  private readonly perceptron = new SingleLayerPerceptron();
  private readonly penalties = new Map<string, number>();

  public score(elements: InteractiveElement[]): InteractiveElement[] {
    const scored = elements.map((element) => {
      const featureVector = buildFeatureVectorFromElement({
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        type: element.type,
        text: element.innerText,
        disabled: false,
      });
      const baseScore = this.perceptron.score(featureVector);
      const penalty = this.penalties.get(element.selector) ?? 0;
      return {
        ...element,
        featureVector,
        riskScore: baseScore - penalty,
      };
    });

    return scored.sort((left, right) => right.riskScore - left.riskScore);
  }

  public penalize(selector: string, magnitude = 1): void {
    const current = this.penalties.get(selector) ?? 0;
    this.penalties.set(selector, current + magnitude);
  }

  public rewardFromNetworkSignal(element: InteractiveElement): void {
    this.perceptron.boostFromNetworkSignal(element.featureVector);
  }

  public exportBrainState(): { bias: number; weights: Record<string, number> } {
    return {
      bias: this.perceptron.getBias(),
      weights: this.perceptron.exportWeights(),
    };
  }
}

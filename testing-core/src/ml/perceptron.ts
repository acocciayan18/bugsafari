import type { FeatureVector } from '../types.js';

const DEFAULT_BIAS = -0.35;

const DEFAULT_WEIGHTS: Record<string, number> = {
  hasId: 0.25,
  hasClass: 0.2,
  isInput: 0.45,
  isButton: 0.45,
  isLink: 0.2,
  isDisabled: 0.4,
  kwLogin: 1.7,
  kwSubmit: 1.6,
  kwPay: 1.8,
  kwCheckout: 1.8,
  kwDelete: 1.9,
  kwRegister: 1.5,
  kwPassword: 1.4,
};

export class SingleLayerPerceptron {
  private readonly weights: Map<string, number>;
  private bias: number;

  constructor(seedWeights: Record<string, number> = DEFAULT_WEIGHTS, bias = DEFAULT_BIAS) {
    this.weights = new Map<string, number>(Object.entries(seedWeights));
    this.bias = bias;
  }

  public score(vector: FeatureVector): number {
    let weightedSum = this.bias;

    for (const [featureName, featureValue] of Object.entries(vector)) {
      const weight = this.weights.get(featureName) ?? 0;
      weightedSum += weight * featureValue;
    }

    return weightedSum;
  }

  public sigmoidScore(vector: FeatureVector): number {
    const raw = this.score(vector);
    return 1 / (1 + Math.exp(-raw));
  }

  public applyDeltaRule(vector: FeatureVector, target: number, learningRate = 0.12): void {
    const prediction = this.sigmoidScore(vector);
    const error = target - prediction;

    for (const [featureName, featureValue] of Object.entries(vector)) {
      const currentWeight = this.weights.get(featureName) ?? 0;
      const updated = currentWeight + learningRate * error * featureValue;
      this.weights.set(featureName, updated);
    }

    this.bias += learningRate * error;
  }

  public boostFromNetworkSignal(vector: FeatureVector): void {
    this.applyDeltaRule(vector, 1, 0.25);
  }

  public penalizeRepeatedPath(vector: FeatureVector): void {
    this.applyDeltaRule(vector, 0, 0.18);
  }

  public exportWeights(): Record<string, number> {
    return Object.fromEntries(this.weights.entries());
  }
}

export function buildFeatureVectorFromElement(input: {
  tagName: string;
  id: string;
  className: string;
  type: string;
  text: string;
  disabled: boolean;
}): FeatureVector {
  const normalizedText = `${input.id} ${input.className} ${input.type} ${input.text}`.toLowerCase();

  return {
    hasId: input.id.length > 0 ? 1 : 0,
    hasClass: input.className.length > 0 ? 1 : 0,
    isInput: input.tagName === 'input' || input.tagName === 'textarea' ? 1 : 0,
    isButton: input.tagName === 'button' || input.type === 'button' || input.type === 'submit' ? 1 : 0,
    isLink: input.tagName === 'a' ? 1 : 0,
    isDisabled: input.disabled ? 1 : 0,
    kwLogin: includesKeyword(normalizedText, ['login', 'sign in', 'auth']) ? 1 : 0,
    kwSubmit: includesKeyword(normalizedText, ['submit', 'save', 'continue']) ? 1 : 0,
    kwPay: includesKeyword(normalizedText, ['pay', 'payment']) ? 1 : 0,
    kwCheckout: includesKeyword(normalizedText, ['checkout', 'cart']) ? 1 : 0,
    kwDelete: includesKeyword(normalizedText, ['delete', 'remove', 'destroy']) ? 1 : 0,
    kwRegister: includesKeyword(normalizedText, ['register', 'signup', 'sign up']) ? 1 : 0,
    kwPassword: includesKeyword(normalizedText, ['password', 'pin']) ? 1 : 0,
  };
}

function includesKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

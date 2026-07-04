import type { FeatureVector } from '../types.js';

const DEFAULT_BIAS = -0.35;

// Learning stability constants: prevent the write-only weight/bias inflation that saturates sigmoid.
const L2_LAMBDA = 0.001; // weight decay pulling weights toward 0 each update
const LR_DECAY = 0.0005; // shrinks effective LR as updates accumulate (refine, don't swing)
const WEIGHT_CLAMP = 6; // hard bound so no single weight can dominate the score

// Clamp a weight/bias into [-WEIGHT_CLAMP, WEIGHT_CLAMP].
function clampWeight(value: number): number {
  return Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, value));
}

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
  // Normalized layout priors (learned at runtime): prefer large, near-top, well-labeled elements.
  areaNorm: 0.3,
  yNorm: -0.2,
  textLenNorm: 0.2,
};

// Reference scales for normalizing layout features into ~[0,1].
const LAYOUT_AREA_REF = 60000; // px² (~a 300×200 control) maps to 1.0
const LAYOUT_VIEWPORT_H = 900; // matches the engine viewport height
const TEXT_LEN_REF = 40; // chars; longer labels saturate to 1.0

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class SingleLayerPerceptron {
  private readonly weights: Map<string, number>;
  private bias: number;
  private updateCount = 0; // drives learning-rate decay

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
    // Decay the effective LR so late-run updates refine rather than swing.
    const lr = learningRate / (1 + LR_DECAY * this.updateCount);
    const prediction = this.sigmoidScore(vector);
    const error = target - prediction;

    for (const [featureName, featureValue] of Object.entries(vector)) {
      const currentWeight = this.weights.get(featureName) ?? 0;
      // L2 weight decay + delta step, then clamp to stop unbounded growth / saturation.
      const updated = currentWeight * (1 - lr * L2_LAMBDA) + lr * error * featureValue;
      this.weights.set(featureName, clampWeight(updated));
    }

    this.bias = clampWeight(this.bias + lr * error);
    this.updateCount += 1;
  }

  public boostFromNetworkSignal(vector: FeatureVector): void {
    this.applyDeltaRule(vector, 1, 0.25);
  }

  public penalizeRepeatedPath(vector: FeatureVector): void {
    this.applyDeltaRule(vector, 0, 0.18);
  }

  // Seed the model from a persisted brain: overlay saved weights on DEFAULT_WEIGHTS so
  // features added after an old snapshot keep their default prior; reset the LR schedule.
  public loadState(weights: Record<string, number>, bias: number): void {
    this.weights.clear();
    for (const [name, value] of Object.entries(DEFAULT_WEIGHTS)) this.weights.set(name, value);
    for (const [name, value] of Object.entries(weights)) this.weights.set(name, value);
    this.bias = bias;
    this.updateCount = 0;
  }

  public exportWeights(): Record<string, number> {
    return Object.fromEntries(this.weights.entries());
  }

  public getBias(): number {
    return this.bias;
  }
}

export function buildFeatureVectorFromElement(input: {
  tagName: string;
  id: string;
  className: string;
  type: string;
  text: string;
  disabled: boolean;
  boundingBox?: { y: number; width: number; height: number };
}): FeatureVector {
  const normalizedText = `${input.id} ${input.className} ${input.type} ${input.text}`.toLowerCase();
  const box = input.boundingBox;

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
    // Normalized layout features (0 when geometry is unknown).
    areaNorm: box ? clamp01((box.width * box.height) / LAYOUT_AREA_REF) : 0,
    yNorm: box ? clamp01(box.y / LAYOUT_VIEWPORT_H) : 0,
    textLenNorm: clamp01(input.text.length / TEXT_LEN_REF),
  };
}

function includesKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => wordBoundaryMatch(value, keyword));
}

// Precompiled word-boundary matchers so 'login' doesn't fire on 'blogger' (value is pre-lowercased).
const boundaryRegexCache = new Map<string, RegExp>();
function wordBoundaryMatch(value: string, keyword: string): boolean {
  let re = boundaryRegexCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`);
    boundaryRegexCache.set(keyword, re);
  }
  return re.test(value);
}

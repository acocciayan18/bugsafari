import type { FeatureVector } from '../types.js';

const DEFAULT_BIAS = -0.35;

// Learning stability constants: prevent the write-only weight/bias inflation that saturates sigmoid.
const L2_LAMBDA = 0.001; // weight decay pulling weights toward 0 each update
const LR_DECAY = 0.0005; // shrinks effective LR as updates accumulate (refine, don't swing)
const WEIGHT_CLAMP = 6; // hard bound so no single weight can dominate the score
// Momentum coefficient: fraction of prior velocity carried into each update. High
// value → consistent-direction rewards accelerate (faster convergence, less
// cold-start) and a single opposite penalty can't flip a high-velocity weight.
const MOMENTUM = 0.9;

// Clamp a weight/bias into [-WEIGHT_CLAMP, WEIGHT_CLAMP].
function clampWeight(value: number): number {
  return Math.max(-WEIGHT_CLAMP, Math.min(WEIGHT_CLAMP, value));
}

/**
 * Compound learning signals observed for the acted element. Each is optional and
 * additive; absence means "not observed", not "negative".
 */
export interface RewardSignals {
  /** The action produced a genuine structural/novel DOM state change. */
  structuralChange?: boolean;
  /** The action triggered successful asynchronous network (xhr/fetch) activity. */
  networkActivity?: boolean;
  /** The action surfaced a detected application fault / vulnerability. */
  faultDetected?: boolean;
  /** The action led back to an already-seen state (contrastive negative). */
  revisit?: boolean;
}

/** One feature's exact linear term in the perceptron logit (weight × value). */
export interface PerceptronTerm {
  feature: string;
  value: number;
  weight: number;
  contribution: number;
}

/** Exact linear decomposition of a perceptron decision (see {@link SingleLayerPerceptron.explain}). */
export interface PerceptronExplanation {
  bias: number;
  rawLogit: number;
  confidence: number;
  terms: PerceptronTerm[];
}

export const DEFAULT_WEIGHTS: Record<string, number> = {
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
  kwSearch: 0.9,
  // Richer contextual priors (element attributes / role / labels).
  hasPlaceholder: 0.15,
  hasAriaLabel: 0.15,
  isSelect: 0.3,
  roleInteractive: 0.25,
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
  // Per-weight learning velocity (momentum state). Transient — never persisted.
  private readonly velocity = new Map<string, number>();
  private bias: number;
  private biasVelocity = 0;
  private updateCount = 0; // drives learning-rate decay

  constructor(seedWeights: Record<string, number> = DEFAULT_WEIGHTS, bias = DEFAULT_BIAS) {
    this.weights = new Map<string, number>(Object.entries(seedWeights));
    this.bias = bias;
  }

  public score(vector: FeatureVector): number {
    let weightedSum = this.bias;

    for (const [featureName, featureValue] of Object.entries(vector)) {
      // Fallback for unknown/incomplete feature data: skip non-finite values so a
      // single bad extraction can never poison the score with NaN/Infinity.
      if (!Number.isFinite(featureValue)) continue;
      const weight = this.weights.get(featureName) ?? 0;
      weightedSum += weight * featureValue;
    }

    return weightedSum;
  }

  public sigmoidScore(vector: FeatureVector): number {
    const raw = this.score(vector);
    return 1 / (1 + Math.exp(-raw));
  }

  /**
   * Glass-box attribution: decompose the linear pre-activation into its exact
   * per-feature terms. For a single-layer perceptron the logit is
   * z = bias + Σ wᵢxᵢ, so featureᵢ's contribution is precisely weightᵢ × valueᵢ —
   * an exact decomposition, not a SHAP/LIME approximation. Non-finite features
   * are skipped identically to score()/applyDeltaRule so the sum always matches.
   */
  public explain(vector: FeatureVector): PerceptronExplanation {
    let rawLogit = this.bias;
    const terms: PerceptronTerm[] = [];
    for (const [featureName, featureValue] of Object.entries(vector)) {
      if (!Number.isFinite(featureValue)) continue;
      const weight = this.weights.get(featureName) ?? 0;
      const contribution = weight * featureValue;
      rawLogit += contribution;
      terms.push({ feature: featureName, value: featureValue, weight, contribution });
    }
    return { bias: this.bias, rawLogit, confidence: 1 / (1 + Math.exp(-rawLogit)), terms };
  }

  /**
   * Momentum-based delta-rule update. Velocity carries a fraction of the prior
   * step so consistent-direction rewards accelerate and lone opposite penalties
   * are damped. LR decays with update count; L2 + clamp keep weights bounded.
   */
  public applyDeltaRule(vector: FeatureVector, target: number, learningRate = 0.12): void {
    // Decay the effective LR so late-run updates refine rather than swing.
    const lr = learningRate / (1 + LR_DECAY * this.updateCount);
    const prediction = this.sigmoidScore(vector);
    const error = target - prediction;

    for (const [featureName, featureValue] of Object.entries(vector)) {
      if (!Number.isFinite(featureValue)) continue;
      const currentWeight = this.weights.get(featureName) ?? 0;
      // Momentum: accumulate velocity, then apply it on top of L2-decayed weight.
      const prevVelocity = this.velocity.get(featureName) ?? 0;
      const nextVelocity = MOMENTUM * prevVelocity + lr * error * featureValue;
      this.velocity.set(featureName, nextVelocity);
      const updated = currentWeight * (1 - lr * L2_LAMBDA) + nextVelocity;
      this.weights.set(featureName, clampWeight(updated));
    }

    this.biasVelocity = MOMENTUM * this.biasVelocity + lr * error;
    this.bias = clampWeight(this.bias + this.biasVelocity);
    this.updateCount += 1;
  }

  /**
   * Update from compound learning signals instead of a single binary target.
   * Signals combine into a bounded target and an adaptive learning rate: a
   * detected fault is the strongest positive, network + structural progress are
   * moderate positives, and a revisit is a contrastive negative.
   */
  public applyReward(vector: FeatureVector, signals: RewardSignals): void {
    let target = 0.5;
    if (signals.faultDetected) target += 0.5;
    if (signals.networkActivity) target += 0.3;
    if (signals.structuralChange) target += 0.2;
    if (signals.revisit) target -= 0.4;
    target = clamp01(target);

    // Stronger deviation from neutral → larger (still bounded) step.
    const strength = Math.abs(target - 0.5) * 2; // 0..1
    const lr = 0.12 + 0.18 * strength; // 0.12..0.30
    this.applyDeltaRule(vector, target, lr);
  }

  // Seed the model from a persisted brain: overlay saved weights on DEFAULT_WEIGHTS so
  // features added after an old snapshot keep their default prior; reset LR + momentum.
  public loadState(weights: Record<string, number>, bias: number): void {
    this.weights.clear();
    this.velocity.clear();
    this.biasVelocity = 0;
    for (const [name, value] of Object.entries(DEFAULT_WEIGHTS)) this.weights.set(name, value);
    for (const [name, value] of Object.entries(weights)) {
      if (Number.isFinite(value)) this.weights.set(name, value);
    }
    this.bias = Number.isFinite(bias) ? bias : DEFAULT_BIAS;
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
  placeholder?: string;
  ariaLabel?: string;
  role?: string;
  name?: string;
}): FeatureVector {
  // Robust fallbacks: coerce every optional string field to '' so incomplete
  // element data never throws or produces non-finite features.
  const tagName = (input.tagName ?? '').toLowerCase();
  const type = (input.type ?? '').toLowerCase();
  const text = input.text ?? '';
  const placeholder = input.placeholder ?? '';
  const ariaLabel = input.ariaLabel ?? '';
  const role = (input.role ?? '').toLowerCase();
  const name = input.name ?? '';

  // Richer context: fold attributes / labels / role into the keyword surface.
  const normalizedText =
    `${input.id ?? ''} ${input.className ?? ''} ${type} ${text} ${placeholder} ${ariaLabel} ${name} ${role}`.toLowerCase();
  const box = input.boundingBox;

  const interactiveRoles = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch'];

  return {
    hasId: (input.id ?? '').length > 0 ? 1 : 0,
    hasClass: (input.className ?? '').length > 0 ? 1 : 0,
    isInput: tagName === 'input' || tagName === 'textarea' ? 1 : 0,
    isButton: tagName === 'button' || type === 'button' || type === 'submit' ? 1 : 0,
    isLink: tagName === 'a' ? 1 : 0,
    isSelect: tagName === 'select' ? 1 : 0,
    isDisabled: input.disabled ? 1 : 0,
    hasPlaceholder: placeholder.length > 0 ? 1 : 0,
    hasAriaLabel: ariaLabel.length > 0 ? 1 : 0,
    roleInteractive: interactiveRoles.includes(role) ? 1 : 0,
    kwLogin: includesKeyword(normalizedText, ['login', 'sign in', 'auth']) ? 1 : 0,
    kwSubmit: includesKeyword(normalizedText, ['submit', 'save', 'continue']) ? 1 : 0,
    kwPay: includesKeyword(normalizedText, ['pay', 'payment']) ? 1 : 0,
    kwCheckout: includesKeyword(normalizedText, ['checkout', 'cart']) ? 1 : 0,
    kwDelete: includesKeyword(normalizedText, ['delete', 'remove', 'destroy']) ? 1 : 0,
    kwRegister: includesKeyword(normalizedText, ['register', 'signup', 'sign up']) ? 1 : 0,
    kwPassword: includesKeyword(normalizedText, ['password', 'pin']) ? 1 : 0,
    kwSearch: includesKeyword(normalizedText, ['search', 'find', 'query', 'filter']) ? 1 : 0,
    // Normalized layout features (0 when geometry is unknown).
    areaNorm: box ? clamp01((box.width * box.height) / LAYOUT_AREA_REF) : 0,
    yNorm: box ? clamp01(box.y / LAYOUT_VIEWPORT_H) : 0,
    textLenNorm: clamp01(text.length / TEXT_LEN_REF),
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

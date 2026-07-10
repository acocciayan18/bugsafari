// ═══════════════════════════════════════════════════════════════
// shared/types/explainability.ts - GLASS-BOX ML DECISION CONTRACTS
// ═══════════════════════════════════════════════════════════════
// The "Decision Lens": exact, per-feature attribution for every autonomous
// target-selection decision. Because the risk model is a single-layer perceptron,
// the pre-activation logit is linear (z = bias + Σ wᵢxᵢ), so each feature's
// contribution to the decision is EXACTLY weightᵢ × valueᵢ — no SHAP/LIME-style
// approximation. This turns the otherwise black-box autonomous agent into a
// glass-box one whose every click is explainable and auditable.

// Socket channel carrying a DecisionRationale (shared so client/server never drift).
export const DECISION_RATIONALE_EVENT = 'decision-rationale' as const;

/** One perceptron feature's exact, signed contribution to the decision logit. */
export interface FeatureContribution {
  /** Raw feature key from the vector (e.g. 'kwLogin'). */
  feature: string;
  /** Operator-facing label (e.g. 'Login / auth keyword'). */
  label: string;
  /** Feature value fed to the model (normalized, ~0..1). */
  value: number;
  /** Current learned weight for this feature. */
  weight: number;
  /** Exact term weight × value (linear model → no approximation). */
  contribution: number;
  /** Cold-start prior weight before any online learning. */
  prior: number;
  /** weight − prior: how far the online Delta-Rule has moved this weight. */
  drift: number;
}

/** "Why this element and not the runner-up" — the decisive counterfactual. */
export interface DecisionCounterfactual {
  selector: string;
  tagName: string;
  finalScore: number;
  mlConfidence: number;
  /** Features that most separated the winner from this runner-up (|Δ| desc). */
  decisiveFeatures: Array<{ feature: string; label: string; delta: number }>;
}

/** Full glass-box rationale for a single autonomous decision. */
export interface DecisionRationale {
  runId?: string;
  sessionId?: string | null;
  /** Exploration step index this decision belongs to. */
  step: number;
  timestamp: string;
  selector: string;
  tagName: string;
  semanticRole: string;
  /** Final blended risk score the engine actually ranked on (incl. penalties). */
  finalScore: number;
  /** Heuristic component (keyword/tag/type weights), pre-blend. */
  heuristicScore: number;
  /** ML component: sigmoid(logit) × 100, pre-blend. */
  mlScore: number;
  /** Bounded ML confidence sigmoid(logit) ∈ 0..1. */
  mlConfidence: number;
  /** Blend ratio applied to the heuristic component. */
  heuristicWeight: number;
  /** Blend ratio applied to the ML component. */
  mlWeight: number;
  /** Perceptron bias term (the constant nudge before any feature fires). */
  bias: number;
  /** Pre-sigmoid logit: bias + Σ wᵢxᵢ. */
  rawLogit: number;
  /** Exact per-feature attribution, active features only, |contribution| desc. */
  contributions: FeatureContribution[];
  /** Runner-up comparison; null when only one candidate existed this step. */
  runnerUp: DecisionCounterfactual | null;
}

import type { DecisionCounterfactual, DecisionRationale, FeatureContribution } from '../../../../../shared/types.ts';
import type { PerceptronExplanation } from '../../../ml/perceptron.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';

// Operator-facing labels for every perceptron feature key. Keeps the Decision
// Lens human-readable without leaking raw model internals to the UI.
const FEATURE_LABELS: Record<string, string> = {
  hasId: 'Has id attribute',
  hasClass: 'Has class attribute',
  isInput: 'Input / textarea field',
  isButton: 'Button control',
  isLink: 'Anchor link',
  isSelect: 'Select dropdown',
  isDisabled: 'Disabled state',
  hasPlaceholder: 'Has placeholder',
  hasAriaLabel: 'Has ARIA label',
  roleInteractive: 'Interactive ARIA role',
  kwLogin: 'Login / auth keyword',
  kwSubmit: 'Submit / save keyword',
  kwPay: 'Payment keyword',
  kwCheckout: 'Checkout / cart keyword',
  kwDelete: 'Destructive (delete) keyword',
  kwRegister: 'Register / signup keyword',
  kwPassword: 'Password / PIN keyword',
  kwSearch: 'Search / filter keyword',
  areaNorm: 'Element size (area)',
  yNorm: 'Vertical position',
  textLenNorm: 'Label text length',
};

function labelFor(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

const round = (n: number, dp = 4): number => Number(n.toFixed(dp));

export interface BuildRationaleInput {
  target: InteractiveElement;
  runnerUp: InteractiveElement | null;
  explanation: PerceptronExplanation;
  runnerUpExplanation: PerceptronExplanation | null;
  heuristicScore: number;
  mlScore: number;
  heuristicWeight: number;
  mlWeight: number;
  priors: Record<string, number>;
  semanticRole: string;
  step: number;
  sessionId?: string | null;
  runId?: string;
}

/**
 * Assemble a wire-ready {@link DecisionRationale} from already-computed numeric
 * pieces. Pure/deterministic and side-effect free — all model math is done by the
 * perceptron; this only shapes, labels, sorts, and derives the counterfactual.
 */
export function buildDecisionRationale(input: BuildRationaleInput): DecisionRationale {
  const { explanation, runnerUpExplanation, priors } = input;

  // Active features only (value ≠ 0 contribute nothing and only add noise),
  // ranked by absolute contribution so the strongest drivers surface first.
  const contributions: FeatureContribution[] = explanation.terms
    .filter((term) => term.value !== 0)
    .map((term) => ({
      feature: term.feature,
      label: labelFor(term.feature),
      value: round(term.value),
      weight: round(term.weight),
      contribution: round(term.contribution),
      prior: round(priors[term.feature] ?? 0),
      drift: round(term.weight - (priors[term.feature] ?? 0)),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const runnerUp = buildCounterfactual(input, explanation, runnerUpExplanation);

  return {
    runId: input.runId,
    sessionId: input.sessionId ?? null,
    step: input.step,
    timestamp: new Date().toISOString(),
    selector: input.target.selector,
    tagName: input.target.tagName,
    semanticRole: input.semanticRole,
    finalScore: round(input.target.riskScore),
    heuristicScore: round(input.heuristicScore, 2),
    mlScore: round(input.mlScore, 2),
    mlConfidence: round(explanation.confidence),
    heuristicWeight: input.heuristicWeight,
    mlWeight: input.mlWeight,
    bias: round(explanation.bias),
    rawLogit: round(explanation.rawLogit),
    contributions,
    runnerUp,
  };
}

/** Derive "why the winner beat the runner-up" from paired feature contributions. */
function buildCounterfactual(
  input: BuildRationaleInput,
  explanation: PerceptronExplanation,
  runnerUpExplanation: PerceptronExplanation | null,
): DecisionCounterfactual | null {
  const { runnerUp } = input;
  if (!runnerUp || !runnerUpExplanation) return null;

  const runnerTerms = new Map(runnerUpExplanation.terms.map((t) => [t.feature, t.contribution]));
  const winnerTerms = new Map(explanation.terms.map((t) => [t.feature, t.contribution]));

  // Union of both feature sets so a driver present on only one side still counts.
  const features = new Set<string>([...winnerTerms.keys(), ...runnerTerms.keys()]);

  const decisiveFeatures = [...features]
    .map((feature) => ({
      feature,
      label: labelFor(feature),
      delta: round((winnerTerms.get(feature) ?? 0) - (runnerTerms.get(feature) ?? 0)),
    }))
    .filter((d) => d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  return {
    selector: runnerUp.selector,
    tagName: runnerUp.tagName,
    finalScore: round(runnerUp.riskScore),
    mlConfidence: round(runnerUpExplanation.confidence),
    decisiveFeatures,
  };
}

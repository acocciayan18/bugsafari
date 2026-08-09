// Shared formatting for reproduction steps — used by the structured ActionStep
// renderer and the string-based ReproductionChecklist so both read in one voice.
// Step phrasing + kind classification come from shared/reproduction.ts so the
// dashboard and testing-core narrate identically; this file adds only UI concerns
// (chips, markdown export, observation splitting).
import { OBSERVATION_PREFIX } from '../../../shared/types.js';
import {
  classifyNarrativeLine as sharedClassify,
  describeConstraintBypass,
  describeInputInjection,
  describeOutcome,
  describeReplayMacro,
  describeRouteStep,
  describeStepLocation,
  describeTarget,
  maskPayload,
  type StepKind,
} from '../../../shared/reproduction.js';
import type { ForensicActionStep } from '../types';

export type { StepKind };

// Design-token classes for the per-step action-type chip — light/dark handled
// entirely by the CSS variables, no dark: variants needed. Kinds are categorical
// (not severity), so all share the neutral status tone; bypass gets a border to
// stand out without spending color — red is reserved for the fault itself.
const CHIP_CLASS: Record<StepKind, string> = {
  navigation: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  click: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  input: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  bypass: 'bg-(--status-neutral-bg) text-(--status-neutral-fg) border border-(--border-strong)',
  macro: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  step: 'bg-(--surface-inset) text-(--text-tertiary)',
};

export const chipClass = (kind: StepKind): string => CHIP_CLASS[kind];

const CHIP_LABEL: Record<StepKind, string> = {
  navigation: 'open',
  click: 'click',
  input: 'type',
  bypass: 'bypass',
  macro: 'rapid',
  step: 'step',
};

export const chipLabel = (kind: StepKind): string => CHIP_LABEL[kind];

// Fallback control noun when the engine recorded no element kind for the step.
const DEFAULT_NOUN: Record<StepKind, string> = {
  navigation: 'page',
  click: 'control',
  input: 'field',
  bypass: 'field',
  macro: 'control',
  step: 'element',
};

// Element name and control noun for a step. A raw CSS selector is never surfaced —
// describeTarget falls back to the noun alone when no label was recorded.
const stepLabel = (step: ForensicActionStep): string => (step.elementLabel ?? step.label ?? '').trim();

const stepNoun = (step: ForensicActionStep, kind: StepKind): string =>
  (step.elementKind ?? '').trim() || DEFAULT_NOUN[kind];

// Map an actionType to the shared step kind.
function kindFor(actionType: string): StepKind {
  switch (actionType) {
    case 'navigation': return 'navigation';
    case 'input': case 'TYPE': case 'INPUT': return 'input';
    case 'bypass': case 'SUBMIT': return 'bypass';
    case 'click': case 'CLICK': case 'HOVER': return 'click';
    case 'macro': case 'MACRO': return 'macro';
    default: return 'step';
  }
}

// Imperative instruction from a structured step, phrased by the shared narrator so
// it matches the backend's live/history playbook voice: what was acted on, what was
// done, and what followed. The payload value is shown in a separate chip (see
// payloadDisplay), so the input instruction omits it.
export function humanizeActionStep(
  step: ForensicActionStep,
): { kind: StepKind; instruction: string; payloadDisplay: string; location: string } {
  const kind = kindFor(step.actionType);
  const observed = describeOutcome(step.outcome);
  // Navigation steps already read the route; the location subline would be redundant.
  const location = kind === 'navigation'
    ? ''
    : describeStepLocation({ url: step.url, containerLabel: step.containerLabel, containerKind: step.containerKind });
  if (kind === 'macro') {
    const action = step.macro ? describeReplayMacro(step.macro) : 'Repeat the recorded rapid-interaction burst';
    return { kind, instruction: `${action}${observed}`, payloadDisplay: '', location };
  }
  const label = stepLabel(step);
  const noun = stepNoun(step, kind);
  const action =
    kind === 'navigation' ? (step.url ? describeRouteStep(step.url) : `Open ${describeTarget(label, noun)}`)
    : kind === 'input' ? describeInputInjection(label, undefined, step.redactValue, noun)
    : kind === 'bypass' ? describeConstraintBypass(label, step.strippedAttributes, step.affectedCount, noun)
    : `Click ${describeTarget(label, noun)}`;
  const repeats = step.repeatCount ?? 1;
  const repeated = repeats > 1 ? `${action}, repeated ${repeats} times in quick succession` : action;
  return { kind, instruction: `${repeated}${observed}`, payloadDisplay: maskPayload(step.payloadText, step.redactValue), location };
}

// Guess a chip kind for a pre-rendered narrative line (string fallback path).
export const classifyNarrativeLine = sharedClassify;

// Strip a leading "Step N. " numbering prefix, if present.
export const stripStepNumber = (line: string): string => line.replace(/^Step\s+\d+\.\s*/, '');

export interface SplitSteps {
  steps: string[];
  observations: string[];
}

// Partition a narrative string[] into action steps and observed-result lines,
// stripping the observation marker and step numbering from each.
export function splitObservations(lines: string[]): SplitSteps {
  const steps: string[] = [];
  const observations: string[] = [];
  for (const line of lines) {
    if (line.startsWith(OBSERVATION_PREFIX)) {
      observations.push(line.slice(OBSERVATION_PREFIX.length).trim());
    } else {
      steps.push(stripStepNumber(line));
    }
  }
  return { steps, observations };
}

// Serialize steps + observations to a Markdown checklist for clipboard paste.
export function toMarkdownChecklist(steps: string[], observations: string[]): string {
  const lines = steps.map((s) => `- [ ] ${s}`);
  if (observations.length > 0) {
    lines.push('', '**Observed:**', ...observations.map((o) => `> ${o}`));
  }
  return lines.join('\n');
}

// Markdown checklist directly from a structured action-step trace. The WHERE subline
// is emitted only when it changes, so same-page steps don't repeat the location.
export function actionStepsToMarkdown(steps: ForensicActionStep[]): string {
  let lastLocation = '';
  return steps
    .map((step) => {
      const { instruction, payloadDisplay, location } = humanizeActionStep(step);
      const payload = payloadDisplay ? ` \`${payloadDisplay}\`` : '';
      const where = location && location !== lastLocation ? `\n  ↳ ${location}` : '';
      if (location) lastLocation = location;
      return `- [ ] ${instruction}${payload}${where}`;
    })
    .join('\n');
}

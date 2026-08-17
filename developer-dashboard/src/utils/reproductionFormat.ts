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
  describeFormSubmission,
  describeOutcome,
  describeReplayMacro,
  describeRouteStep,
  describeTarget,
  isApiEndpoint,
  maskPayload,
  routePath,
  stepContainerField,
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
  submit: 'bg-(--status-neutral-bg) text-(--status-neutral-fg) border border-(--border-strong)',
  bypass: 'bg-(--status-neutral-bg) text-(--status-neutral-fg) border border-(--border-strong)',
  macro: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  step: 'bg-(--surface-inset) text-(--text-tertiary)',
};

export const chipClass = (kind: StepKind): string => CHIP_CLASS[kind];

const CHIP_LABEL: Record<StepKind, string> = {
  navigation: 'open',
  click: 'click',
  input: 'type',
  submit: 'submit',
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
  submit: 'button',
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
    case 'submit': case 'FORM_SUBMIT': return 'submit';
    case 'bypass': case 'SUBMIT': return 'bypass';
    case 'click': case 'CLICK': case 'HOVER': return 'click';
    case 'macro': case 'MACRO': return 'macro';
    default: return 'step';
  }
}

// The WHERE of a step, broken into labeled parts for the playbook's context line:
// page route, container/form, and target element. Navigation steps read the route in
// their own instruction, so route + element are left blank to avoid restating them.
export interface StepWhere {
  route: string;
  container: string;
  element: string;
}

// describeTarget prefixes "the "; the labeled Element field reads better without it.
const stripLeadingThe = (phrase: string): string => phrase.replace(/^the\s+/i, '');

// Imperative instruction from a structured step, phrased by the shared narrator so
// it matches the backend's live/history playbook voice: what was acted on, what was
// done, and what followed. The payload value is shown in a separate chip (see
// payloadDisplay), so the input instruction omits it. `where` carries the step's
// location as labeled parts (route / container-form / element) for the context line.
export function humanizeActionStep(
  step: ForensicActionStep,
): { kind: StepKind; instruction: string; payloadDisplay: string; where: StepWhere } {
  const kind = kindFor(step.actionType);
  const observed = describeOutcome(step.outcome);
  const label = stepLabel(step);
  const noun = stepNoun(step, kind);
  // Navigation steps read the route in their own instruction, so route + element are
  // left blank to avoid restating them in the context line.
  const where: StepWhere = {
    route: kind === 'navigation' || isApiEndpoint(step.url) ? '' : routePath(step.url),
    container: stepContainerField(step.containerLabel, step.containerKind),
    element: kind === 'navigation' || kind === 'macro' || kind === 'submit' ? '' : stripLeadingThe(describeTarget(label, noun)),
  };
  if (kind === 'macro') {
    const action = step.macro ? describeReplayMacro(step.macro) : 'Repeat the recorded rapid-interaction burst';
    return { kind, instruction: `${action}${observed}`, payloadDisplay: '', where };
  }
  const action =
    kind === 'navigation' ? (step.url ? describeRouteStep(step.url) : `Open ${describeTarget(label, noun)}`)
    // Weave the typed value into the sentence (was a detached red chip) so a single
    // JSON payload reads as one value in one field, matching the backend narrative.
    : kind === 'input' ? describeInputInjection(label, step.payloadText, step.redactValue, noun)
    : kind === 'submit' ? describeFormSubmission(step.payloadText, label, noun)
    : kind === 'bypass' ? describeConstraintBypass(label, step.strippedAttributes, step.affectedCount, noun, step.payloadText, step.redactValue)
    : `Click ${describeTarget(label, noun)}`;
  const repeats = step.repeatCount ?? 1;
  const repeated = repeats > 1 ? `${action}, repeated ${repeats} times in quick succession` : action;
  // Value now lives inline in the input/submit/bypass sentence, so no separate value chip.
  const payloadDisplay = kind === 'input' || kind === 'submit' || kind === 'bypass' ? '' : maskPayload(step.payloadText, step.redactValue);
  return { kind, instruction: `${repeated}${observed}`, payloadDisplay, where };
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

// Labeled WHERE segments for a step's context line — `Route /x`, `Form "Y"` (the
// container self-labels its kind), `Element "Z" button`. Empty parts are dropped.
export function whereSegments(where: StepWhere): string[] {
  const segments: string[] = [];
  if (where.route) segments.push(`Route ${where.route}`);
  if (where.container) segments.push(where.container);
  if (where.element) segments.push(`Element ${where.element}`);
  return segments;
}

// Markdown checklist directly from a structured action-step trace. The labeled WHERE
// line is emitted only when it changes, so same-page steps don't repeat the location.
export function actionStepsToMarkdown(steps: ForensicActionStep[]): string {
  let lastWhere = '';
  return steps
    .map((step) => {
      const { instruction, payloadDisplay, where } = humanizeActionStep(step);
      const payload = payloadDisplay ? ` \`${payloadDisplay}\`` : '';
      const line = whereSegments(where).join(' · ');
      const suffix = line && line !== lastWhere ? `\n  ↳ ${line}` : '';
      if (line) lastWhere = line;
      return `- [ ] ${instruction}${payload}${suffix}`;
    })
    .join('\n');
}

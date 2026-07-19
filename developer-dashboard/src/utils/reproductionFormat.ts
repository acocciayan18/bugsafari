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
  navigation: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
  click: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
  input: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
  bypass: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)] border border-[var(--border-strong)]',
  macro: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
  step: 'bg-[var(--surface-inset)] text-[var(--text-tertiary)]',
};

export const chipClass = (kind: StepKind): string => CHIP_CLASS[kind];

const CHIP_LABEL: Record<StepKind, string> = {
  navigation: 'open',
  click: 'click',
  input: 'type',
  bypass: 'bypass',
  macro: 'replay',
  step: 'step',
};

export const chipLabel = (kind: StepKind): string => CHIP_LABEL[kind];

// A human-readable target for a structured step: its resolved label, else selector.
function target(step: ForensicActionStep, kind: StepKind): string {
  const label = (step.elementLabel ?? '').trim();
  if (label) return label;
  const s = (step.selector ?? '').trim();
  if (s && s !== 'N/A') return s;
  if (kind === 'navigation') return 'the next page';
  if (kind === 'input' || kind === 'bypass') return 'the input field';
  return 'the element';
}

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
// it matches the backend's live/history playbook voice. The payload value is shown
// in a separate chip (see payloadDisplay), so the input instruction omits it.
export function humanizeActionStep(
  step: ForensicActionStep,
): { kind: StepKind; instruction: string; payloadDisplay: string } {
  const kind = kindFor(step.actionType);
  if (kind === 'macro') {
    return { kind, instruction: step.macro?.summary || 'Replay recorded stress-scenario burst', payloadDisplay: '' };
  }
  const t = target(step, kind);
  const instruction =
    kind === 'navigation' ? `Go to ${t}`
    : kind === 'input' ? describeInputInjection(t)
    : kind === 'bypass' ? describeConstraintBypass(t, step.strippedAttributes, step.affectedCount)
    : kind === 'click' ? `Click ${t}`
    : t;
  return { kind, instruction, payloadDisplay: maskPayload(step.payloadText, step.redactValue) };
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

// Markdown checklist directly from a structured action-step trace.
export function actionStepsToMarkdown(steps: ForensicActionStep[]): string {
  return steps
    .map((step) => {
      const { instruction, payloadDisplay } = humanizeActionStep(step);
      const payload = payloadDisplay ? ` \`${payloadDisplay}\`` : '';
      return `- [ ] ${instruction}${payload}`;
    })
    .join('\n');
}

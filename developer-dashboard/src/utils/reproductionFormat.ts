// Shared formatting for reproduction steps — used by the structured ActionStep
// renderer and the string-based ReproductionChecklist so both read in one voice.
import { OBSERVATION_PREFIX } from '../../../shared/types.js';
import type { ForensicActionStep } from '../types';

export type StepKind = 'navigation' | 'click' | 'input' | 'bypass' | 'macro' | 'step';

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

// A meaningful selector/label or a generic fallback per kind.
function target(selector: string | undefined, kind: StepKind): string {
  const s = (selector ?? '').trim();
  if (s && s !== 'N/A') return s;
  if (kind === 'navigation') return 'the next page';
  if (kind === 'input' || kind === 'bypass') return 'the input field';
  return 'the element';
}

// Imperative instruction from a structured step's fields (payload shown separately).
export function humanizeActionStep(step: ForensicActionStep): { kind: StepKind; instruction: string } {
  const kind = ((): StepKind => {
    switch (step.actionType) {
      case 'navigation': return 'navigation';
      case 'input': return 'input';
      case 'bypass': return 'bypass';
      case 'click': return 'click';
      case 'macro': return 'macro';
      default: return 'step';
    }
  })();
  // A macro carries its own human summary; render it verbatim, no raw params.
  if (kind === 'macro') {
    return { kind, instruction: step.macro?.summary || 'Replay recorded stress-scenario burst' };
  }
  const t = target(step.selector, kind);
  const instruction =
    kind === 'navigation' ? `Go to ${t}`
    : kind === 'input' ? `Type into ${t}`
    : kind === 'bypass' ? `Remove validation on ${t}, then submit`
    : kind === 'click' ? `Click ${t}`
    : t;
  return { kind, instruction };
}

// Guess a chip kind for a pre-rendered narrative line (string fallback path).
export function classifyNarrativeLine(text: string): StepKind {
  const s = text.trim();
  if (/^Go to /i.test(s)) return 'navigation';
  if (/^(Type |Enter data)/i.test(s)) return 'input';
  if (/^Remove client-side validation/i.test(s)) return 'bypass';
  if (/^(Click|Hover)/i.test(s)) return 'click';
  return 'step';
}

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
      const { instruction } = humanizeActionStep(step);
      const payload = step.payloadText ? ` \`${step.payloadText}\`` : '';
      return `- [ ] ${instruction}${payload}`;
    })
    .join('\n');
}

// Fallback playbook builder for legacy findings whose backend reproductionPlaybook
// is empty. Renders human-readable steps only — the raw selector is never shown;
// when no recorded label exists it collapses to a concise semantic fallback
// (`<button#submit>`), never a full DOM path.
import type { ActionBreadcrumb, ActionRecord, ForensicCrashReport } from '../types';
import { describeTarget, isSelectorLike, semanticFallbackFromSelector } from '../../../shared/reproduction.js';

export type PlaybookStep = {
  stepNumber: number;
  instruction: string;
  selector?: string;
  payload?: string;
};

function safeSlice(input: string, max = 60): string {
  if (!input) return input;
  return input.length > max ? `${input.slice(0, max)}…` : input;
}

function decodePayload(payload?: string): string | undefined {
  if (!payload) return undefined;
  return safeSlice(payload, 120);
}

// A recorded human label, or undefined when it's missing or a raw selector.
function realLabel(label?: string): string | undefined {
  const name = (label ?? '').trim();
  return name && !isSelectorLike(name) ? name : undefined;
}

// Name the control as a step should read it: `the "Register" button` from a real
// label, else a concise semantic fallback derived from the selector.
function targetPhrase(selector: string | undefined, label: string | undefined, noun: string): string {
  const name = realLabel(label);
  return name ? describeTarget(name, noun) : semanticFallbackFromSelector(selector);
}

function buildStep(
  action: string,
  selector: string | undefined,
  payload: string | undefined,
  label: string | undefined,
  index: number,
): PlaybookStep {
  const a = (action ?? '').toUpperCase();
  const value = payload ? safeSlice(payload, 60) : undefined;
  let instruction: string;

  if (a === 'INPUT' || a === 'TYPE') {
    const target = targetPhrase(selector, label, 'field');
    instruction = value ? `Enter "${value}" into ${target}` : `Enter a value into ${target}`;
  } else if (a === 'NAVIGATION' || a === 'NAVIGATE') {
    instruction = `Navigate using ${targetPhrase(selector, label, 'control')}`;
  } else if (a === 'SUBMIT') {
    instruction = `Submit via ${targetPhrase(selector, label, 'control')}`;
  } else if (a === 'HOVER') {
    instruction = `Hover over ${targetPhrase(selector, label, 'element')}`;
  } else {
    instruction = `Click ${targetPhrase(selector, label, 'element')}`;
  }

  return { stepNumber: index + 1, instruction, selector, payload: value };
}

function breadcrumbToStep(bc: ActionBreadcrumb, index: number): PlaybookStep {
  return buildStep(bc.action ?? '', bc.selector, decodePayload(bc.payload), undefined, index);
}

export function mapForensicBreadcrumbsToPlaybook(breadcrumbs: readonly ActionBreadcrumb[]): PlaybookStep[] {
  return breadcrumbs.map((bc, idx) => breadcrumbToStep(bc, idx));
}

export function mapIncidentStepsToPlaybook(steps: readonly ActionRecord[] | undefined): PlaybookStep[] {
  if (!steps || steps.length === 0) return [];
  return steps.map((s, idx) =>
    buildStep(s.type, s.selector, decodePayload(s.payload), s.elementLabel ?? s.fallbackLabel, idx),
  );
}

export function mapForensicReportToPlaybook(report: ForensicCrashReport): PlaybookStep[] {
  return mapForensicBreadcrumbsToPlaybook(report.breadcrumbs);
}

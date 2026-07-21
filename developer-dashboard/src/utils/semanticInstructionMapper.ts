// Fallback playbook builder for legacy findings that carry only raw breadcrumbs
// (no pre-generated reproductionPlaybook). Phrasing + element naming come from
// shared/reproduction.ts so no surface ever prints a raw selector chain.
import type { ActionBreadcrumb, ActionRecord, ForensicCrashReport } from '../types';
import {
  describeActionRecord,
  describeConstraintBypass,
  describeInputInjection,
  humanizeSelector,
} from '../../../shared/reproduction.js';

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

// One imperative instruction per breadcrumb; element named via humanizeSelector.
function breadcrumbToStep(bc: ActionBreadcrumb, index: number): PlaybookStep {
  const action = (bc.action ?? '').toUpperCase();
  const payload = bc.payload ? safeSlice(bc.payload, 120) : undefined;
  const label = humanizeSelector(bc.selector);

  let instruction: string;
  if (action === 'CLICK' || action === 'HOVER') {
    instruction = action === 'HOVER' ? `Hover over ${label}` : `Click ${label}`;
  } else if (action === 'INPUT' || action === 'TYPE') {
    instruction = describeInputInjection(label, payload);
  } else if (action === 'NAVIGATION' || action === 'NAVIGATE') {
    instruction = `Navigate via ${label}`;
  } else if (action === 'SUBMIT' || action.includes('STRIP') || action.includes('MAXLENGTH')) {
    instruction = describeConstraintBypass(label);
  } else {
    instruction = `Interact with ${label}`;
  }

  return { stepNumber: index + 1, instruction, selector: bc.selector, payload };
}

export function mapForensicBreadcrumbsToPlaybook(breadcrumbs: readonly ActionBreadcrumb[]): PlaybookStep[] {
  return breadcrumbs.map((bc, idx) => breadcrumbToStep(bc, idx));
}

export function mapIncidentStepsToPlaybook(steps: readonly ActionRecord[] | undefined): PlaybookStep[] {
  if (!steps || steps.length === 0) return [];
  // ActionRecords carry recorded labels/outcomes — the shared narrator uses them
  // directly; a label-less record gets a semantic reading of its selector instead.
  return steps.map((s, idx) => ({
    stepNumber: idx + 1,
    instruction: describeActionRecord(
      s.elementLabel || s.fallbackLabel ? s : { ...s, fallbackLabel: humanizeSelector(s.selector) },
    ),
    selector: s.selector,
    payload: s.payload,
  }));
}

export function mapForensicReportToPlaybook(report: ForensicCrashReport): PlaybookStep[] {
  return mapForensicBreadcrumbsToPlaybook(report.breadcrumbs);
}

import type { Page, Response } from 'playwright';
import type { ActionRecord } from '../../../../shared/types.js';
import { OBSERVATION_PREFIX } from '../../../../shared/types.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { FindingSpecifics } from '../knowledgeBase/findingEvidence.js';
import {
  elementNoun,
  endpointLabel,
  narrateActionRecords,
  resolveControlName,
  resolveElementLabel,
} from '../../../../shared/reproduction.js';
import { minimizeActionRecords } from '../../domain/services/forensics/stepMinimizer.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';

// ═══════════════════════════════════════════════════════════════
// bugs/finders/injectionEvidence.ts — SHARED INJECTION EVIDENCE
// ═══════════════════════════════════════════════════════════════
// Both injection finders (differential oracle + signal oracle) owe a promoted
// finding the same clean evidence: a tag-qualified selector, a selector-safe field
// label, the exact payload kept separate from the message, the real preceding action
// history as reproduction steps, and the server response as a distinct Observed
// Result. This module is the single owner of that assembly plus the response-
// correlation helpers, so the two finders stay identical and never drift.

/** Origin of a URL, or '' when it cannot be parsed. */
export function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Pathname of a URL, or '' when it cannot be parsed. */
export function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export interface SubmissionTarget {
  actionPath: string | null;
  fieldName: string | null;
}

/** Resolve the parent form's action path + the field's wire name for correlation. */
export async function resolveSubmissionTarget(page: Page, selector: string): Promise<SubmissionTarget> {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return { actionPath: null, fieldName: null };
      const form = el.closest('form');
      const action = form ? form.getAttribute('action') ?? location.href : null;
      return {
        actionPath: action ? new URL(action, location.href).pathname : null,
        fieldName: el.getAttribute('name') || el.id || null,
      };
    }, selector)
    .catch(() => ({ actionPath: null, fieldName: null }));
}

// Is this response the answer to OUR submission? Positive evidence only: the request
// carried the injected value or the field name, or it hit the parent form's action.
// GET (search) and state-changing verbs both qualify — a query bypass is often a GET.
export function correlates(response: Response, value: string, target: SubmissionTarget, origin: string): boolean {
  try {
    if (origin !== '' && safeOrigin(response.url()) !== origin) return false;
    const request = response.request();
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch' && type !== 'document') return false;
    const body = request.postData() ?? '';
    const url = response.url();
    if (value !== '' && (body.includes(value) || url.includes(encodeURIComponent(value)) || url.includes(value))) return true;
    if (target.fieldName !== null && (body.includes(target.fieldName) || url.includes(target.fieldName))) return true;
    return target.actionPath !== null && safePathname(url) === target.actionPath;
  } catch {
    return false;
  }
}

export interface InjectionEvidenceInput {
  element: InteractiveElement;
  /** The exact injected value — named in the message + specifics, shown verbatim in the trace. */
  payload: string;
  /** URL the fault was observed on — the INPUT/NAVIGATE record's page. */
  faultUrl: string;
  /** Server-response sentence (no prefix); rendered as the separate Observed Result line. */
  observation: string;
  /** HTTP verb + URL of the correlated response, when known — drives the submit step + specifics. */
  method?: string;
  responseUrl?: string;
  statusCode?: number;
}

// Drop a sibling finder's leftover probe of the culprit field so it never leaks into THIS
// injection's playbook: an earlier INPUT/TYPE on the same selector (a different payload) and
// any SUBMIT it fired. The navigation and genuine setup on OTHER fields are kept.
function pruneCulpritEchoes(records: ActionRecord[], culpritSelector: string): ActionRecord[] {
  return records.filter((r) => {
    const culpritInput = (r.type === 'INPUT' || r.type === 'TYPE') && r.selector === culpritSelector;
    const staleSubmit = r.type === 'SUBMIT' || r.type === 'FORM_SUBMIT';
    return !culpritInput && !staleSubmit;
  });
}

export interface InjectionEvidenceParts {
  /** Tag-qualified, stable selector for the card (e.g. `input#login-username`). */
  displaySelector: string;
  /** Selector-safe human label for the field — never its live value. */
  label: string;
  noun: string;
  reproductionPlaybook: string[];
  reproductionActions: ActionRecord[];
  specifics: FindingSpecifics;
}

/** Assemble the reproduction playbook, replayable trace, selector, label and specifics. */
export function buildInjectionEvidence(input: InjectionEvidenceInput): InjectionEvidenceParts {
  const { element, payload, faultUrl, observation, method, responseUrl, statusCode } = input;

  const noun = elementNoun(element.tagName, element.type);
  // Selector-safe field identity — never the field's live value (the payload).
  const label = resolveControlName({ label: resolveElementLabel(element), selector: element.selector, tagName: element.tagName, type: element.type });
  const paramName = element.name || element.id || '';
  // A precise, tag-qualified selector so the card reads `input#login-username`, not `<input>`.
  const displaySelector = element.id
    ? `${element.tagName}#${element.id}`
    : element.name
      ? `${element.tagName}[name="${element.name}"]`
      : element.selector;

  // Reproduction: the real preceding action history + the injection step, so the
  // playbook carries the full sequence instead of "No earlier steps were recorded".
  // Scope to the faulting page + culprit field, or unrelated cross-page exploration
  // (the preamble that navigated here) and simultaneous burst siblings leak in as steps.
  // Then drop a SIBLING finder's own probe of THIS field: an earlier INPUT/TYPE on the
  // culprit selector (e.g. an XSS finder's "onerror=") and any stale SUBMIT it left behind.
  // The finder appends its OWN authoritative injection + submit below, so keeping those
  // produced the out-of-order "type onerror= → submit → type ' OR '1'='1" playbook.
  const history = pruneCulpritEchoes(
    minimizeActionRecords(ReproductionPlaybookStore.snapshot(), { faultUrl, culpritSelector: element.selector }),
    element.selector,
  );
  const injectionInput: ActionRecord = {
    timestamp: new Date().toISOString(),
    type: 'INPUT',
    selector: element.selector,
    url: faultUrl,
    payload,
    elementLabel: label,
    elementKind: noun,
    redactValue: false, // an attack string, not user data — show it verbatim
  };
  const trace: ActionRecord[] = history.length > 0
    ? [...history, injectionInput]
    : [{ timestamp: injectionInput.timestamp, type: 'NAVIGATE', selector: faultUrl, url: faultUrl }, injectionInput];

  const narrated = narrateActionRecords(trace);
  const destination = responseUrl ? endpointLabel(method ?? '', responseUrl) : 'the server';
  const submitStep = `Step ${narrated.length + 1}. Submit the form to send the value to ${destination}`;
  const reproductionPlaybook = [...narrated, submitStep, `${OBSERVATION_PREFIX}${observation}`];

  const specifics: FindingSpecifics = {
    field: paramName || label,
    payload,
    endpoint: responseUrl ? safePathname(responseUrl) : undefined,
    method,
    statusCode,
  };

  return { displaySelector, label, noun, reproductionPlaybook, reproductionActions: trace, specifics };
}

// Reproduction-step narration — the single cross-package source of step phrasing.
// Both testing-core (live/history playbooks) and developer-dashboard (forensic
// drawer) render steps through these pure builders so every surface reads in one
// voice. No runtime deps: types only.

import type { ActionRecord, ActionType, ActionOutcome } from './types/bug.js';

const MAX_LABEL_LENGTH = 60;
const MAX_PAYLOAD_LENGTH = 80;
const REDACTED = '«redacted»';

export type StepKind = 'navigation' | 'click' | 'input' | 'bypass' | 'macro' | 'step';

export interface ElementLabelSource {
  innerText?: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  tagName?: string;
  type?: string;
}

/** Minimal burst shape the narration needs — `ConcurrentBurstResult` satisfies it. */
export interface BurstSummary {
  attempted: number;
  completed: number;
  durationMs: number;
}

const collapse = (value?: string): string => (value ?? '').replace(/\s+/g, ' ').trim();

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/** Generic structural fallback name for an element — a tag type, never a selector. */
export function genericElementLabel(tagName?: string, type?: string): string {
  const tag = (tagName ?? '').toLowerCase();
  const elementType = (type ?? '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input field';
  if (tag === 'a') return 'link';
  if (tag === 'button' || elementType === 'button' || elementType === 'submit') return 'button';
  return tag || 'element';
}

/**
 * Most human-actionable label for an element: inner text → aria label → placeholder
 * → name → id → generic tag type. Never returns a raw CSS selector.
 */
export function resolveElementLabel(element: ElementLabelSource): string {
  const innerText = collapse(element.innerText);
  if (innerText) return truncate(innerText, MAX_LABEL_LENGTH);
  const ariaLabel = collapse(element.ariaLabel);
  if (ariaLabel) return truncate(ariaLabel, MAX_LABEL_LENGTH);
  const placeholder = collapse(element.placeholder);
  if (placeholder) return truncate(placeholder, MAX_LABEL_LENGTH);
  const name = collapse(element.name);
  if (name) return truncate(name, MAX_LABEL_LENGTH);
  const id = collapse(element.id);
  if (id) return truncate(id, MAX_LABEL_LENGTH);
  return genericElementLabel(element.tagName, element.type);
}

const ATTR_LABEL_PATTERN = /\[(?:aria-label|placeholder|name|title|alt)[*^$~|]?=\s*["']?([^"'\]]+)["']?\]/i;

/**
 * Human-readable name derived from a raw CSS selector — used ONLY when no recorded
 * label exists. Reads the LAST segment of the chain and renders a semantic fallback
 * (`the "Email" field`, `<button#submit>`), never the full selector chain.
 */
export function humanizeSelector(selector?: string): string {
  const raw = collapse(selector);
  if (!raw || raw === 'N/A') return 'element';
  const segments = raw.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  const last = segments[segments.length - 1] ?? raw;
  const attrLabel = last.match(ATTR_LABEL_PATTERN)?.[1];
  const tag = (last.match(/^[a-zA-Z][\w-]*/)?.[0] ?? '').toLowerCase();
  const id = last.match(/#([\w-]+)/)?.[1];
  const className = last.match(/\.([\w-]+)/)?.[1];
  if (attrLabel) return `the "${truncate(attrLabel, MAX_LABEL_LENGTH)}" ${genericElementLabel(tag)}`;
  if (id) return `<${tag || 'element'}#${id}>`;
  if (className) return `<${tag || 'element'}.${className}>`;
  if (tag) return genericElementLabel(tag);
  return 'element';
}

// Capitalized element kind for operator-facing descriptions (Button/Input/Link).
function elementKind(tagName?: string, type?: string): string {
  const tag = (tagName ?? '').toLowerCase();
  const elementType = (type ?? '').toLowerCase();
  if (tag === 'button' || elementType === 'button' || elementType === 'submit') return 'Button';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'Input';
  if (tag === 'a') return 'Link';
  if (tag) return tag.charAt(0).toUpperCase() + tag.slice(1);
  return 'Element';
}

// Label for humanizeElement: text/aria/placeholder/name only (id shown separately).
function resolveDescriptiveLabel(element: ElementLabelSource): string {
  const source =
    collapse(element.innerText) ||
    collapse(element.ariaLabel) ||
    collapse(element.placeholder) ||
    collapse(element.name);
  return source ? truncate(source, MAX_LABEL_LENGTH) : '';
}

/** Readable element description for telemetry/logs — e.g. `Button: "Register" (id: #register-btn)`. */
export function humanizeElement(element: ElementLabelSource): string {
  const kind = elementKind(element.tagName, element.type);
  const label = resolveDescriptiveLabel(element);
  const id = collapse(element.id);
  const idPart = id ? ` (id: #${id})` : '';
  return label ? `${kind}: "${label}"${idPart}` : `${kind}${idPart}`;
}

const defaultLabelForType = (type: ActionType): string =>
  type === 'TYPE' || type === 'INPUT' || type === 'SUBMIT' ? 'input field' : 'element';

// Redaction-aware payload rendering; truncation lives here only.
function renderPayload(payload?: string, redact?: boolean): string {
  if (!payload) return '';
  return redact ? REDACTED : truncate(payload, MAX_PAYLOAD_LENGTH);
}

/** Display form of a payload value for a separate value chip — masked when redacted. */
export function maskPayload(payload?: string, redact?: boolean): string {
  return renderPayload(payload, redact);
}

// ─────────────────────────────────────────────────────────────
// Canonical scenario-step builders (single source of phrasing)
// ─────────────────────────────────────────────────────────────

/**
 * Constraint-stripping / form-bypass step. Names the exact validation attributes
 * removed when known, so a developer sees which guard was defeated on which field.
 */
export function describeConstraintBypass(label: string, attributes?: string[], affectedCount?: number): string {
  const attrs = (attributes ?? []).filter(Boolean);
  if (attrs.length === 0) {
    return `Remove client-side validation on "${label}", then submit`;
  }
  const scope = affectedCount && affectedCount > 1 ? ` across ${affectedCount} fields` : '';
  return `Remove ${attrs.join(', ')} from "${label}"${scope}, then submit`;
}

/** Payload-injection step. Redacts auth/password values; truncation lives here only. */
export function describeInputInjection(label: string, payload?: string, redact?: boolean): string {
  const value = renderPayload(payload, redact);
  return value ? `Type "${value}" into "${label}"` : `Enter data into "${label}"`;
}

/** Single-element zero-wait concurrent burst (ButtonSpammer). */
export function describeConcurrentBurst(outcome: BurstSummary, label: string, kind: string): string {
  return (
    `Click the ${kind} "${label}" ${outcome.attempted}× rapidly, no wait ` +
    `(${outcome.completed}/${outcome.attempted} landed, ${outcome.durationMs}ms)`
  );
}

/** Multi-sibling zero-wait concurrent burst (InteractionSimulator.concurrentClicker). */
export function describeConcurrentBurstSiblings(outcome: BurstSummary): string {
  return (
    `Click ${outcome.attempted} sibling elements at once, no wait ` +
    `(${outcome.completed}/${outcome.attempted} landed, ${outcome.durationMs}ms)`
  );
}

/** Deterministic coordinate-bombing step (CoordinateBombing). */
export function describeCoordinateBombing(count: number, width: number, height: number): string {
  return `Fire ${count} deterministic grid coordinate clicks across the ${width}x${height} viewport`;
}

/** RouteTrasher opening step. */
export function describeRouteTrashStart(repetitions: number, originPath: string): string {
  return `Trash navigation from ${originPath} (${repetitions}×): rapid history traversal and native back/forward validation`;
}

/** RouteTrasher history back/forward step. `iteration` is 1-based. */
export function describeRouteTrashNavigation(
  iteration: number,
  direction: 'back' | 'forward',
  index: number,
  url: string,
): string {
  return `Iteration ${iteration}: history ${direction} (index ${index}) → ${url}`;
}

/** RouteTrasher inconsistency: the URL changed but the DOM did not update to match. */
export function describeRouteInconsistency(fromUrl: string, toUrl: string): string {
  return `Navigation inconsistency: URL changed ${fromUrl} → ${toUrl} with no corresponding DOM update.`;
}

/** RouteTrasher drift-restore step. */
export function describeRouteTrashDrift(landed: string, originPath: string): string {
  return `Route bursts drifted to ${landed}; restoring to origin ${originPath}.`;
}

/** RouteTrasher: a mutation provoked one or more backend 5xx failures (MEDIUM). */
export function describeRouteTrashServerError(navType: string, count: number, url: string): string {
  return `[MEDIUM] ${navType} triggered ${count} backend server error(s) (HTTP 5xx) at ${url} — likely unvalidated route/parameter input.`;
}

/** RouteTrasher: expected defensive 4xx responses, handled gracefully (INFORMATIONAL). */
export function describeRouteTrashDefensive(navType: string, count: number, url: string): string {
  return `[INFO] ${navType} met ${count} defensive response(s) (HTTP 4xx) at ${url} — request rejected gracefully, no finding.`;
}

/** RouteTrasher: an unhandled client-side exception fired during a mutation (CRITICAL). */
export function describeRouteTrashClientCrash(navType: string, count: number, url: string): string {
  return `[CRITICAL] ${navType} caused ${count} unhandled client-side exception(s) at ${url} — reproducible finding captured.`;
}

/** RouteTrasher: a mutation left the app on a white/blank screen (CRITICAL). */
export function describeRouteTrashWhiteScreen(navType: string, url: string): string {
  return `[CRITICAL] ${navType} left the application white-screened at ${url} — render/routing failure.`;
}

/** NetworkSaboteur step. */
export function describeNetworkSabotage(mode: string): string {
  return `Sabotage the next API/XHR request (${mode} mode) to test error resilience`;
}

/** Navigation traversal step — clicking a navigation control to discover new state. */
export function describeNavigation(label: string): string {
  return `Navigate via control "${label}" to discover a new application state`;
}

/** Adaptive recovery round after apparent graph exhaustion. */
export function describeRecovery(requeued: number): string {
  return `Adaptive recovery: re-queued ${requeued} candidate path${requeued === 1 ? '' : 's'} after apparent exhaustion`;
}

// ─────────────────────────────────────────────────────────────
// Outcome clause + step-kind classification
// ─────────────────────────────────────────────────────────────

/** Render an observed outcome as a trailing clause, or '' when nothing was observed. */
export function describeOutcome(outcome?: ActionOutcome): string {
  if (!outcome) return '';
  const parts: string[] = [];
  if (outcome.navigatedTo) parts.push(`navigated to ${outcome.navigatedTo}`);
  if (typeof outcome.httpStatus === 'number') parts.push(`HTTP ${outcome.httpStatus}`);
  if (parts.length === 0 && outcome.domChanged === false) parts.push('no visible change');
  return parts.length ? ` → ${parts.join(', ')}` : '';
}

/** The step kind for an action record — drives the UI action-type chip. */
export function kindForRecord(type: ActionType): StepKind {
  switch (type) {
    case 'NAVIGATE':
    case 'NAVIGATION':
      return 'navigation';
    case 'TYPE':
    case 'INPUT':
      return 'input';
    case 'SUBMIT':
      return 'bypass';
    case 'MACRO':
      return 'macro';
    case 'HOVER':
    case 'CLICK':
    default:
      return 'click';
  }
}

/** Guess a chip kind for a pre-rendered narrative line (string fallback path). */
export function classifyNarrativeLine(text: string): StepKind {
  const s = text.trim();
  if (/^Go to /i.test(s)) return 'navigation';
  if (/^(Type |Enter data)/i.test(s)) return 'input';
  if (/^Remove /i.test(s)) return 'bypass';
  if (/^(Click|Hover|Navigate via)/i.test(s)) return 'click';
  return 'step';
}

// ─────────────────────────────────────────────────────────────
// Rolling action-buffer narration
// ─────────────────────────────────────────────────────────────

/**
 * Render a single action record WITHOUT a leading "Step N." prefix (numbering is
 * applied by the caller). Appends the observed outcome clause when present.
 */
export function describeActionRecord(record: ActionRecord): string {
  const base = describeSingleAction(record);
  const repeats = record.repeatCount ?? 1;
  const withRepeat = repeats > 1 ? `${base} (repeat ${repeats}× rapidly)` : base;
  return `${withRepeat}${describeOutcome(record.outcome)}`;
}

function describeSingleAction(record: ActionRecord): string {
  const rawLabel = collapse(record.elementLabel) || collapse(record.fallbackLabel);
  const label = rawLabel || defaultLabelForType(record.type);

  switch (record.type) {
    case 'NAVIGATE':
    case 'NAVIGATION':
      return record.url ? `Go to ${record.url}` : 'Go to the starting page';

    case 'TYPE':
    case 'INPUT':
      return describeInputInjection(label, record.payload, record.redactValue);

    case 'SUBMIT':
      return describeConstraintBypass(label, record.strippedAttributes, record.affectedCount);

    case 'MACRO':
      return record.macro?.summary || rawLabel || 'Replay recorded stress-scenario burst';

    case 'NETWORK':
      return record.payload
        ? `${describeNetworkSabotage(label)} — target ${record.payload}`
        : describeNetworkSabotage(label);

    case 'HOVER':
      return rawLabel ? `Hover over "${rawLabel}"` : 'Hover over an element';

    case 'CLICK':
    default:
      return rawLabel ? `Click "${rawLabel}"` : 'Click an element';
  }
}

/** Render an ordered, sequentially-numbered playbook from raw action records. */
export function narrateActionRecords(records: ActionRecord[]): string[] {
  return records.map((record, index) => `Step ${index + 1}. ${describeActionRecord(record)}`);
}

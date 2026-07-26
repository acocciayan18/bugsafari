// Reproduction-step narration — the single cross-package source of step phrasing.
// Both testing-core (live/history playbooks) and developer-dashboard (forensic
// drawer) render steps through these pure builders so every surface reads in one
// voice. No runtime deps: types only.

import type { ActionRecord, ActionType, ActionOutcome, ReplayMacro, StepTarget } from './types/bug.js';

const MAX_LABEL_LENGTH = 60;
const MAX_PAYLOAD_LENGTH = 80;
const MAX_NAMED_TARGETS = 5;
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

/**
 * Plain-English noun a developer would use for a control ("button", "link",
 * "email field"). Finer-grained than {@link genericElementLabel}, which stays the
 * structural fallback LABEL; this is the noun the reproduction steps read with.
 */
export function elementNoun(tagName?: string, type?: string): string {
  const tag = (tagName ?? '').toLowerCase();
  const elementType = (type ?? '').toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'dropdown';
  if (tag === 'textarea') return 'text box';
  if (tag === 'button' || elementType === 'button' || elementType === 'submit' || elementType === 'reset') {
    return 'button';
  }
  if (tag === 'input') {
    if (elementType === 'checkbox') return 'checkbox';
    if (elementType === 'radio') return 'radio button';
    if (elementType === 'file') return 'file picker';
    return 'field';
  }
  return tag ? 'control' : 'element';
}

// A raw CSS selector leaked into a label reads as engine noise in the playbook —
// detected here so the step falls back to the control's noun instead.
function isSelectorLike(value: string): boolean {
  return /^[#.[]/.test(value) || value.includes(':nth-') || value.includes('>');
}

/** Name one control the way a step should read it — `the "Register" button`. */
export function describeTarget(label?: string, kind?: string): string {
  const noun = collapse(kind) || 'element';
  const name = collapse(label);
  return name && !isSelectorLike(name) ? `the "${truncate(name, MAX_LABEL_LENGTH)}" ${noun}` : `the ${noun}`;
}

/** Name a set of controls, capped so a wide burst stays one readable line. */
export function describeTargetList(targets: StepTarget[]): string {
  const named = targets.filter((target) => collapse(target.label) || collapse(target.kind));
  if (named.length === 0) return '';
  const shown = named.slice(0, MAX_NAMED_TARGETS).map((target) => describeTarget(target.label, target.kind));
  const hidden = named.length - shown.length;
  if (hidden > 0) shown.push(`${hidden} more`);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
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
export function describeConstraintBypass(
  label: string,
  attributes?: string[],
  affectedCount?: number,
  kind?: string,
): string {
  const target = describeTarget(label, kind ?? 'field');
  const attrs = (attributes ?? []).filter(Boolean);
  if (attrs.length === 0) {
    return `Remove the browser validation from ${target}, then submit the form`;
  }
  const scope = affectedCount && affectedCount > 1 ? ` (and ${affectedCount - 1} more field${affectedCount === 2 ? '' : 's'})` : '';
  return `Remove the ${attrs.join(', ')} validation from ${target}${scope}, then submit the form`;
}

/** Payload-injection step. Redacts auth/password values; truncation lives here only. */
export function describeInputInjection(label: string, payload?: string, redact?: boolean, kind?: string): string {
  const target = describeTarget(label, kind ?? 'field');
  const value = renderPayload(payload, redact);
  if (collapse(kind) === 'dropdown') {
    return value ? `Select "${value}" from ${target}` : `Choose an option from ${target}`;
  }
  return value ? `Type "${value}" into ${target}` : `Enter a value into ${target}`;
}

/** Single-element zero-wait concurrent burst (ButtonSpammer). */
export function describeConcurrentBurst(outcome: BurstSummary, label: string, kind: string): string {
  return (
    `Click ${describeTarget(label, kind)} ${outcome.attempted} times as fast as possible ` +
    `(${outcome.completed} of ${outcome.attempted} clicks registered in ${outcome.durationMs}ms)`
  );
}

/** Multi-sibling zero-wait concurrent burst (InteractionSimulator.concurrentClicker). */
export function describeConcurrentBurstSiblings(outcome: BurstSummary, targets?: StepTarget[]): string {
  const named = describeTargetList(targets ?? []);
  const list = named ? `: ${named}` : '';
  return (
    `Click ${outcome.attempted} controls at the same time${list} ` +
    `(${outcome.completed} of ${outcome.attempted} clicks registered in ${outcome.durationMs}ms)`
  );
}

/**
 * Params-based human description of a replay macro — names the actual elements /
 * dimensions from the stored params so the playbook never shows a vague
 * "Click N sibling elements at once". Live execution metrics (landed/ms) are
 * intentionally omitted; per-step duration is surfaced separately by the renderer.
 */
export function describeReplayMacro(macro: ReplayMacro): string {
  const params = macro.params ?? {};
  switch (macro.scenario) {
    case 'ConcurrentSiblingBurst': {
      const targets = params.targets ?? [];
      const count = targets.length || (params.selectors ?? []).filter(Boolean).length || params.count || 0;
      const named = describeTargetList(targets);
      const list = named ? `: ${named}` : '';
      return `Click ${count} control${count === 1 ? '' : 's'} at the same time${list}`;
    }
    case 'CoordinateBombing': {
      const count = params.count ?? 0;
      const dims = params.width && params.height ? ` of the ${params.width}×${params.height} window` : '';
      return `Click ${count} points spread evenly across the visible area${dims}`;
    }
    case 'RouteTrasher': {
      const reps = params.repetitions ?? 0;
      return `Press the browser Back and Forward buttons ${reps} time${reps === 1 ? '' : 's'} in a row`;
    }
    default:
      return macro.summary || 'Repeat the recorded rapid-interaction burst';
  }
}

/** Deterministic coordinate-bombing step (CoordinateBombing). */
export function describeCoordinateBombing(count: number, width: number, height: number): string {
  return `Click ${count} points spread evenly across the visible area of the ${width}×${height} window`;
}

/** RouteTrasher opening step. */
export function describeRouteTrashStart(repetitions: number, originPath: string): string {
  return `Starting from ${originPath}, press the browser Back and Forward buttons ${repetitions} times in a row`;
}

// Engine navigation identifiers rendered as what the developer would actually do.
const NAVIGATION_LABELS: Record<string, string> = {
  rapid_history: 'Rapid Back/Forward presses',
  history_back: 'Pressing browser Back',
  history_forward: 'Pressing browser Forward',
  history_navigation: 'Browser history navigation',
};

/** Plain-English name for an engine navigation identifier. */
export function navigationLabel(navType: string): string {
  return NAVIGATION_LABELS[navType] ?? navType.replace(/_/g, ' ');
}

/** RouteTrasher history back/forward step. `iteration` is 1-based. */
export function describeRouteTrashNavigation(
  iteration: number,
  direction: 'back' | 'forward',
  url: string,
): string {
  return `Round ${iteration}: press browser ${direction === 'back' ? 'Back' : 'Forward'} → ${url}`;
}

/** RouteTrasher inconsistency: the URL changed but the DOM did not update to match. */
export function describeRouteInconsistency(fromUrl: string, toUrl: string): string {
  return `The address changed from ${fromUrl} to ${toUrl}, but the page content never updated.`;
}

/** RouteTrasher drift-restore step. */
export function describeRouteTrashDrift(landed: string, originPath: string): string {
  return `Back/Forward presses ended on ${landed}; returning to ${originPath}.`;
}

/** RouteTrasher: a mutation provoked one or more backend 5xx failures (MEDIUM). */
export function describeRouteTrashServerError(navType: string, count: number, url: string): string {
  return `[MEDIUM] ${navigationLabel(navType)} caused ${count} server error(s) (HTTP 5xx) at ${url} — the route or its parameters are likely unvalidated.`;
}

/** RouteTrasher: expected defensive 4xx responses, handled gracefully (INFORMATIONAL). */
export function describeRouteTrashDefensive(navType: string, count: number, url: string): string {
  return `[INFO] ${navigationLabel(navType)} was rejected ${count} time(s) with a 4xx response at ${url} — handled correctly, no bug.`;
}

/** RouteTrasher: an unhandled client-side exception fired during a mutation (CRITICAL). */
export function describeRouteTrashClientCrash(navType: string, count: number, url: string): string {
  return `[CRITICAL] ${navigationLabel(navType)} caused ${count} unhandled JavaScript error(s) at ${url}.`;
}

/** RouteTrasher: a mutation left the app on a white/blank screen (CRITICAL). */
export function describeRouteTrashWhiteScreen(navType: string, url: string): string {
  return `[CRITICAL] ${navigationLabel(navType)} left the page blank at ${url} — the view failed to render.`;
}

/** NetworkSaboteur step. */
export function describeNetworkSabotage(mode: string): string {
  return `Make the next API request fail (${collapse(mode).toLowerCase() || 'aborted'}) to test the app's error handling`;
}

/** Navigation traversal step — clicking a navigation control to discover new state. */
export function describeNavigation(label: string, kind?: string): string {
  return `Click ${describeTarget(label, kind ?? 'control')} to reach a new part of the app`;
}

/** Adaptive recovery round after apparent graph exhaustion. */
export function describeRecovery(requeued: number): string {
  return `Retrying ${requeued} unexplored path${requeued === 1 ? '' : 's'} after the app appeared fully explored`;
}

// ─────────────────────────────────────────────────────────────
// Outcome clause + step-kind classification
// ─────────────────────────────────────────────────────────────

/** Render an observed outcome as a trailing clause, or '' when nothing was observed. */
export function describeOutcome(outcome?: ActionOutcome): string {
  if (!outcome) return '';
  const parts: string[] = [];
  if (outcome.navigatedTo) parts.push(`the app moved to ${outcome.navigatedTo}`);
  if (typeof outcome.httpStatus === 'number') parts.push(`the server responded HTTP ${outcome.httpStatus}`);
  if (parts.length === 0 && outcome.domChanged === false) parts.push('nothing on the page changed');
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
  if (/^(Open|Go to) /i.test(s)) return 'navigation';
  if (/^(Type |Enter a value|Select )/i.test(s)) return 'input';
  if (/^Remove /i.test(s)) return 'bypass';
  if (/^(Click|Hover|Press|Starting from)/i.test(s)) return 'click';
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
  const withRepeat = repeats > 1 ? `${base}, repeated ${repeats} times in quick succession` : base;
  return `${withRepeat}${describeOutcome(record.outcome)}`;
}

function describeSingleAction(record: ActionRecord): string {
  // An absent label is fine: describeTarget falls back to the control's noun
  // ("the field") rather than inventing a placeholder name.
  const rawLabel = collapse(record.elementLabel) || collapse(record.fallbackLabel);
  const kind = collapse(record.elementKind);

  switch (record.type) {
    case 'NAVIGATE':
    case 'NAVIGATION':
      return record.url ? `Open ${record.url}` : 'Open the starting page';

    case 'TYPE':
    case 'INPUT':
      return describeInputInjection(rawLabel, record.payload, record.redactValue, kind);

    case 'SUBMIT':
      return describeConstraintBypass(rawLabel, record.strippedAttributes, record.affectedCount, kind);

    case 'MACRO':
      return record.macro
        ? describeReplayMacro(record.macro)
        : 'Repeat the recorded rapid-interaction burst';

    case 'NETWORK':
      return record.payload
        ? `${describeNetworkSabotage(rawLabel)} — affected request: ${record.payload}`
        : describeNetworkSabotage(rawLabel);

    case 'HOVER':
      return `Hover over ${describeTarget(rawLabel, kind || 'element')}`;

    case 'CLICK':
    default:
      return `Click ${describeTarget(rawLabel, kind || 'element')}`;
  }
}

/** Render an ordered, sequentially-numbered playbook from raw action records. */
export function narrateActionRecords(records: ActionRecord[]): string[] {
  return records.map((record, index) => `Step ${index + 1}. ${describeActionRecord(record)}`);
}

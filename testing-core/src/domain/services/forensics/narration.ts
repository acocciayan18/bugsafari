import type { ActionRecord, ActionType } from '../../../../../shared/types.ts';

/**
 * Forensic narration — the single source of truth for reproduction-step phrasing.
 *
 * Every reproduction step shown in live telemetry, the UI, and saved history is
 * produced here, so identical actions always read identically. Two kinds of
 * builders live side by side:
 *
 *  - `describeActionRecord` / `narrateActionRecords` render the rolling action
 *    buffer (the fallback playbook) into clean manual-replication instructions,
 *    never leaking technical nth-child selector strings.
 *  - The `describe*` scenario builders below are the ONLY place each stress/fuzz
 *    scenario's deliberate step text is phrased; scenarios call these instead of
 *    hand-rolling strings, and the action-record cases above reuse them so both
 *    paths stay byte-identical.
 */

const MAX_LABEL_LENGTH = 60;
const MAX_PAYLOAD_LENGTH = 80;

interface ElementLabelSource {
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

/**
 * Generic, human-friendly fallback name for an element when no descriptive
 * label exists — a structural tag type, never a selector.
 */
export function genericElementLabel(tagName?: string, type?: string): string {
  const tag = (tagName ?? '').toLowerCase();
  const elementType = (type ?? '').toLowerCase();

  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input field';
  if (tag === 'a') return 'link';
  if (tag === 'button' || elementType === 'button' || elementType === 'submit') return 'button';
  return tag || 'element';
}

/**
 * Resolve the most human-actionable label for an element, scanning properties in
 * the required order: explicit inner text → visible semantic (aria) label →
 * input placeholder → name attribute → id → generic structural tag type.
 * Deliberately never returns the raw CSS selector.
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

const defaultLabelForType = (type: ActionType): string =>
  type === 'TYPE' || type === 'INPUT' || type === 'SUBMIT' ? 'input field' : 'element';

// ─────────────────────────────────────────────────────────────
// Canonical scenario-step builders (single source of phrasing)
// ─────────────────────────────────────────────────────────────

/** Constraint-stripping / form-bypass step (FormBypasser, DataFuzzer, SUBMIT records). */
export function describeConstraintBypass(label: string): string {
  return `Bypassed interface safeguards on input field: "${label}" by removing client constraint hooks`;
}

/** Payload-injection step (DataFuzzer, TYPE/INPUT records). Truncation lives here only. */
export function describeInputInjection(label: string, payload?: string): string {
  const value = payload ? truncate(payload, MAX_PAYLOAD_LENGTH) : '';
  return `Input data value "${value}" provided to input field: "${label}"`;
}

/** Single-element zero-wait concurrent burst (ButtonSpammer). */
export function describeConcurrentBurst(outcome: BurstSummary, label: string, kind: string): string {
  return (
    `Concurrent zero-wait burst: ${outcome.attempted} clicks on ${kind} "${label}" ` +
    `→ ${outcome.completed}/${outcome.attempted} completed in ${outcome.durationMs}ms`
  );
}

/** Multi-sibling zero-wait concurrent burst (InteractionSimulator.concurrentClicker). */
export function describeConcurrentBurstSiblings(outcome: BurstSummary): string {
  return (
    `Concurrent zero-wait burst across ${outcome.attempted} sibling elements ` +
    `→ ${outcome.completed}/${outcome.attempted} completed in ${outcome.durationMs}ms`
  );
}

/** Deterministic coordinate-bombing step (CoordinateBombing). */
export function describeCoordinateBombing(count: number, width: number, height: number): string {
  return `Fire ${count} deterministic grid coordinate clicks across the ${width}x${height} viewport`;
}

/** RouteTrasher opening step. */
export function describeRouteTrashStart(repetitions: number, originPath: string): string {
  return `Trash navigation from ${originPath} (${repetitions}×): rapid history traversal, query/hash/malformed-route mutation, and interrupted transitions`;
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

/** RouteTrasher query-mutation step. `iteration` is 1-based. */
export function describeRouteTrashMutation(
  iteration: number,
  param: string | undefined,
  mutation: string | undefined,
  url: string,
): string {
  return `Iteration ${iteration}: mutate query '${param}' via ${mutation} → ${url}`;
}

/** RouteTrasher malformed dynamic-route-param step. `iteration` is 1-based. */
export function describeRouteTrashPathMutation(
  iteration: number,
  mutation: string | undefined,
  url: string,
): string {
  return `Iteration ${iteration}: inject malformed route segment '${mutation}' → ${url}`;
}

/** RouteTrasher hash-route mutation step. `iteration` is 1-based. */
export function describeRouteTrashHashMutation(
  iteration: number,
  mutation: string | undefined,
  url: string,
): string {
  return `Iteration ${iteration}: mutate hash route to '${mutation}' → ${url}`;
}

/** RouteTrasher interrupted-transition step. `iteration` is 1-based. */
export function describeRouteTrashInterrupted(iteration: number, url: string): string {
  return `Iteration ${iteration}: interrupt a pending route transition mid-flight → ${url}`;
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

/** Confirmed state transition after a traversal (hashes shortened for readability). */
export function describeStateTransition(fromHash: string, toHash: string, label: string): string {
  const short = (h: string): string => (h ? h.slice(0, 8) : 'unknown');
  return `State transition via "${label}": ${short(fromHash)} → ${short(toHash)}`;
}

/** Adaptive recovery round after apparent graph exhaustion. */
export function describeRecovery(requeued: number): string {
  return `Adaptive recovery: re-queued ${requeued} candidate path${requeued === 1 ? '' : 's'} after apparent exhaustion`;
}

// ─────────────────────────────────────────────────────────────
// Rolling action-buffer narration
// ─────────────────────────────────────────────────────────────

/**
 * Render a single action record into a human-actionable description WITHOUT a
 * leading "Step N." prefix (numbering is applied by the caller). Reuses the
 * canonical builders so buffer narration matches scenario-window phrasing.
 */
export function describeActionRecord(record: ActionRecord): string {
  const rawLabel = collapse(record.fallbackLabel);
  const label = rawLabel || defaultLabelForType(record.type);

  switch (record.type) {
    case 'NAVIGATE':
    case 'NAVIGATION':
      return `Navigate to target interface view: ${record.url}`;

    case 'TYPE':
    case 'INPUT':
      return describeInputInjection(label, record.payload);

    case 'SUBMIT':
      return describeConstraintBypass(label);

    case 'HOVER':
      return rawLabel
        ? `Hover interaction triggered on element: "${rawLabel}"`
        : 'Hover interaction triggered on an unlabeled element';

    case 'CLICK':
    default:
      return rawLabel
        ? `Click interaction triggered on element: "${rawLabel}"`
        : 'Click interaction triggered on an unlabeled element';
  }
}

/** Render an ordered, sequentially-numbered playbook from raw action records. */
export function narrateActionRecords(records: ActionRecord[]): string[] {
  return records.map((record, index) => `Step ${index + 1}. ${describeActionRecord(record)}`);
}

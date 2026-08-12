// Reproduction-step narration — the single cross-package source of step phrasing.
// Both testing-core (live/history playbooks) and developer-dashboard (forensic
// drawer) render steps through these pure builders so every surface reads in one
// voice. No runtime deps: types only.

import type { ActionRecord, ActionType, ActionOutcome, ReplayMacro, StepTarget } from './types/bug.js';

const MAX_LABEL_LENGTH = 60;
const MAX_PAYLOAD_LENGTH = 2048;
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
export function isSelectorLike(value: string): boolean {
  return /^[#.[]/.test(value) || value.includes(':nth-') || value.includes('>');
}

const GENERIC_FALLBACK = '<element>';

// Concise semantic fallback for an element whose only identity is a raw CSS
// selector — collapses a DOM path to its final control (`<button#submit>`,
// `<input.email-field>`), stripping positional pseudos. Never returns a full path.
export function semanticFallbackFromSelector(selector?: string): string {
  const raw = collapse(selector);
  if (!raw) return GENERIC_FALLBACK;
  const last = raw.split('>').pop()!.trim().replace(/:nth-[a-z-]+\([^)]*\)/gi, '');
  const tag = (/^[a-z][a-z0-9-]*/i.exec(last)?.[0] ?? '').toLowerCase();
  const id = /#([\w-]+)/.exec(last)?.[1];
  const cls = /\.([\w-]+)/.exec(last)?.[1];
  const attr = /\[([\w-]+)(?:[~|^$*]?=["']?([^"'\]]+)["']?)?\]/.exec(last);
  const name = attr ? attr[2] ?? attr[1] : undefined;
  const qualifier = id ? `#${id}` : cls ? `.${cls}` : name ? `[${name}]` : '';
  return `<${`${tag}${qualifier}` || 'element'}>`;
}

/** Everything a producer knows about one control when it needs to name it. */
export interface ControlIdentity {
  /** Pre-resolved human label (resolveElementLabel output), when available. */
  label?: string;
  /** Raw CSS selector — used ONLY to distil a semantic fallback, never rendered. */
  selector?: string;
  tagName?: string;
  type?: string;
}

/**
 * THE resolver every user-facing surface names a control with. Priority: an
 * explicit human label → a semantic fallback distilled from the selector's final
 * segment → the element's tag. Guarantees a structural DOM path never reaches
 * Telemetry, Findings, Forensics, Playbooks, exports, or any API payload.
 */
export function resolveControlName(identity: ControlIdentity): string {
  const label = collapse(identity.label);
  if (label && !isSelectorLike(label)) return truncate(label, MAX_LABEL_LENGTH);
  const fromSelector = semanticFallbackFromSelector(identity.selector);
  if (fromSelector !== GENERIC_FALLBACK) return fromSelector;
  const tag = collapse(identity.tagName).toLowerCase();
  return tag ? `<${tag}>` : GENERIC_FALLBACK;
}

/**
 * A control name is DESCRIPTIVE when it identifies the control to a human: not a bare
 * structural tag (`<input>`), not an input's raw value (`1`, `65535`), not empty.
 * Attribution paths use this to drop a fabricated culprit rather than show a misleading
 * Element — a render/console fault has no acted control to name.
 */
export function isDescriptiveControlName(label?: string): boolean {
  const value = collapse(label);
  if (!value) return false;
  if (/^<[a-z][\w-]*>$/i.test(value)) return false;
  if (/^[+-]?\d[\d.,]*$/.test(value)) return false;
  return true;
}

// A structural DOM path inside free text: three-plus selector tokens joined by
// `>`, or a single token carrying a positional pseudo. Case-sensitive, gap-free
// and depth-gated by design, so ordinary prose ("Step 1 > Step 2", "a > b",
// "A → B") is never rewritten.
const DOM_PATH_CHAIN =
  /(?:[a-z][\w-]*|[#.][\w-]+|\*)(?:[#.][\w-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*(?:\s*>\s*(?:[a-z][\w-]*|[#.][\w-]+|\*)(?:[#.][\w-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*){2,}/g;
const POSITIONAL_TOKEN = /(?:[a-z][\w-]*|[#.][\w-]+)(?:[#.][\w-]+|\[[^\]]*\])*:nth-[a-z-]+\([^)]*\)/g;

/**
 * Last-mile net for operator-facing free text: rewrites any structural DOM path
 * left in a message to its semantic fallback. Producers should name controls via
 * {@link resolveControlName}; this makes the wire safe regardless of who emits.
 */
export function scrubSelectors(text: string): string {
  return text
    .replace(DOM_PATH_CHAIN, (match) => semanticFallbackFromSelector(match))
    .replace(POSITIONAL_TOKEN, (match) => semanticFallbackFromSelector(match));
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

// Redaction-aware payload rendering. Stress payloads render verbatim so the step
// shows what was executed; only genuine sensitive fields mask, and only pathological
// amplification blobs past the cap get a factual length note (never a bare stub).
function renderPayload(payload?: string, redact?: boolean): string {
  if (!payload) return '';
  if (redact) return REDACTED;
  if (payload.length <= MAX_PAYLOAD_LENGTH) return payload;
  return `${payload.slice(0, MAX_PAYLOAD_LENGTH)}…(${payload.length} chars total, full value preserved for replay)`;
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

/** Everything the constraint-bypass reproduction playbook needs about the culprit field. */
export interface ConstraintBypassPlaybookInput {
  /** Page URL the bypass was confirmed on (opening step); omitted ⇒ no Open step. */
  url?: string;
  /** Human label of the specific field that received the payload. */
  label: string;
  /** Control noun (field / text box / dropdown …); defaults to 'field'. */
  kind?: string;
  /** Wire parameter name (`name`/`id`) of that field — pins the exact input on a multi-field form. */
  paramName?: string;
  /** UI container the field lives in — framed after the route so the field is located. */
  containerLabel?: string;
  containerKind?: string;
  /** The browser-only guard that was stripped (required, maxlength=40, type=email). */
  strippedAttribute: string;
  /** The browser-rejected value the server accepted ('' ⇒ empty submission). */
  payload: string;
  /** Mask the value in narration (auth/sensitive fields). */
  redact?: boolean;
  /** State-changing method + relative endpoint + status of the accepting request. */
  method: string;
  endpoint: string;
  status: number;
}

/**
 * Numbered, developer-friendly reproduction for a client-side constraint bypass.
 * Names the SPECIFIC field (label + control type + wire parameter) that received the
 * payload — so a multi-field form no longer reads as a vague "a field was bypassed" —
 * and states the exact guard removed and the endpoint that accepted the value.
 */
export function describeConstraintBypassPlaybook(input: ConstraintBypassPlaybookInput): string[] {
  const kind = collapse(input.kind) || 'field';
  const target = describeTarget(input.label, kind);
  const param = collapse(input.paramName);
  const paramClause = param && !isSelectorLike(param) ? ` (parameter "${truncate(param, MAX_LABEL_LENGTH)}")` : '';
  const attr = collapse(input.strippedAttribute) || 'browser';
  const value = renderPayload(input.payload, input.redact);
  const inject = value
    ? `Enter "${value}" into ${target}${paramClause}`
    : `Submit ${target}${paramClause} with an empty value`;

  const lines: string[] = [];
  if (collapse(input.url)) lines.push(describeRouteStep(input.url));
  const container = describeContainerEntry(input.containerLabel, input.containerKind);
  if (container) lines.push(container);
  lines.push(`Remove the ${attr} validation from ${target}${paramClause} (a browser-only guard)`);
  lines.push(inject);
  lines.push(
    `Submit the form. ${input.method} ${input.endpoint} accepted it (HTTP ${input.status}), so the server never re-checked the rule`,
  );
  return lines.map((line, index) => `Step ${index + 1}. ${line}`);
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

/**
 * Single-element burst INTENT — the deliberate action, recorded BEFORE the burst
 * fires so an immediate crash still yields a reproduction step. Carries no live
 * metrics (none exist yet); the outcome is appended later as an observation.
 */
export function describeConcurrentBurstIntent(label: string, kind: string, attempted: number): string {
  return `Click ${describeTarget(label, kind)} ${attempted} times as fast as possible`;
}

/** Multi-sibling burst INTENT (pre-burst). `attempted` overrides the target count when known. */
export function describeConcurrentBurstSiblingsIntent(targets?: StepTarget[], attempted?: number): string {
  const named = describeTargetList(targets ?? []);
  const list = named ? `: ${named}` : '';
  const count = attempted ?? (targets?.length ?? 0);
  return `Click ${count} controls at the same time${list}`;
}

/** Observed burst metrics, rendered as a trailing clause / observation line. */
export function describeBurstOutcome(outcome: BurstSummary): string {
  return `${outcome.completed} of ${outcome.attempted} clicks registered in ${outcome.durationMs}ms`;
}

/**
 * Honest observation for a burst where ZERO clicks registered — the controls were
 * not actuable (obscured / detached / covered). Flags the reproduction as invalid so
 * a coincidental fault is never dressed up as "clicked N times" when nothing landed.
 */
export function describeInertBurst(attempted: number): string {
  return (
    `Invalid: 0 of ${attempted} clicks registered. The target controls could not be clicked ` +
    `(hidden, removed, or covered), so this burst never actually interacted with the app.`
  );
}

/** Single-element zero-wait concurrent burst (ButtonSpammer) — intent + outcome. */
export function describeConcurrentBurst(outcome: BurstSummary, label: string, kind: string): string {
  return `${describeConcurrentBurstIntent(label, kind, outcome.attempted)} (${describeBurstOutcome(outcome)})`;
}

/** Multi-sibling zero-wait concurrent burst (InteractionSimulator.concurrentClicker) — intent + outcome. */
export function describeConcurrentBurstSiblings(outcome: BurstSummary, targets?: StepTarget[]): string {
  return `${describeConcurrentBurstSiblingsIntent(targets ?? [], outcome.attempted)} (${describeBurstOutcome(outcome)})`;
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
  return `Round ${iteration}: press browser ${direction === 'back' ? 'Back' : 'Forward'}, landing on ${url}`;
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
  return `[MEDIUM] ${navigationLabel(navType)} caused ${count} server error(s) (HTTP 5xx) at ${url}. The route or its values are likely not being checked.`;
}

/** RouteTrasher: expected defensive 4xx responses, handled gracefully (INFORMATIONAL). */
export function describeRouteTrashDefensive(navType: string, count: number, url: string): string {
  return `[INFO] ${navigationLabel(navType)} was rejected ${count} time(s) with a 4xx response at ${url}. This was handled correctly, so it is not a bug.`;
}

/** RouteTrasher: an unhandled client-side exception fired during a mutation (CRITICAL). */
export function describeRouteTrashClientCrash(navType: string, count: number, url: string): string {
  return `[CRITICAL] ${navigationLabel(navType)} caused ${count} unhandled JavaScript error(s) at ${url}.`;
}

/** RouteTrasher: a mutation left the app on a white/blank screen (CRITICAL). */
export function describeRouteTrashWhiteScreen(navType: string, url: string): string {
  return `[CRITICAL] ${navigationLabel(navType)} left the page blank at ${url}. The view failed to render.`;
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

/**
 * Redirect-loop observation (CWE-835). A loop's hops are AUTOMATIC browser
 * redirects, not manual navigations — so they render as ONE observed outcome after
 * the real triggering action, never as a run of artificial "Navigate to X" steps.
 */
export function describeRedirectLoopObservation(chain: string, mechanism: 'http' | 'client'): string {
  const via = mechanism === 'http' ? 'HTTP redirect chain' : 'client-side route oscillation';
  const trail = collapse(chain);
  return `Observe: the application enters an unconditioned redirect loop that never settles (${via}${trail ? `: ${trail}` : ''})`;
}

// ─────────────────────────────────────────────────────────────
// Outcome clause + step-kind classification
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// UI-context framing (route + container) — the WHERE of a step
// ─────────────────────────────────────────────────────────────

/** Domain-stripped route (pathname + query + hash) for human-readable playbooks. */
export function routePath(url?: string): string {
  const raw = collapse(url);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return raw;
  }
}

// Data/API endpoints (fetch/XHR/GraphQL targets) — fired BY an interaction, never a
// page a user browses to. A reproduction step must never say "Navigate to" one: the
// endpoint is a consequence of an action, so route-step builders skip it and keep the
// real document URL as the navigation.
const API_ENDPOINT_RE = /(?:^|\/)(?:api|apis|ajax|graphql|gql|rpc|xhr|webhook|hooks?)(?:\/|\.|$)|\.(?:json|graphql)$/i;

/** True when a URL is a backend request endpoint, not a user-facing document/page. */
export function isApiEndpoint(url?: string): boolean {
  const raw = collapse(url);
  if (!raw) return false;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split(/[?#]/)[0];
  }
  return API_ENDPOINT_RE.test(path);
}

/** Route step — "Navigate to /settings/users". Opens/transitions the playbook's page. */
export function describeRouteStep(url?: string): string {
  const path = routePath(url);
  return path ? `Navigate to ${path}` : 'Open the starting page';
}

// Overlay-style containers a developer must actively open/switch into (vs. an in-flow
// section that's simply already on the page).
const OVERLAY_CONTAINER_RE = /modal|dialog|drawer|popover|popup|dropdown|offcanvas/i;
const TAB_CONTAINER_RE = /tab/i;

/**
 * Container-entry framing — "Open the "Create User" modal", "Switch to the "Billing"
 * tab panel", "Go to the "Filters" panel". Returns '' for an unnamed in-flow container
 * (a bare section/form/nav with no accessible name adds noise, not location).
 */
export function describeContainerEntry(label?: string, kind?: string): string {
  const k = collapse(kind);
  if (!k) return '';
  const name = collapse(label);
  const named = Boolean(name) && !isSelectorLike(name);
  // An unnamed, non-overlay container is not worth a framing step.
  if (!named && !OVERLAY_CONTAINER_RE.test(k)) return '';
  const verb = OVERLAY_CONTAINER_RE.test(k) ? 'Open' : TAB_CONTAINER_RE.test(k) ? 'Switch to' : 'Go to';
  return named ? `${verb} the "${truncate(name, MAX_LABEL_LENGTH)}" ${k}` : `${verb} the ${k}`;
}

// Locative container clause — "in the "Create User" modal", "on the "Billing" tab
// panel". Skips an unnamed in-flow container (same rule as describeContainerEntry).
function locativeContainer(label?: string, kind?: string): string {
  const k = collapse(kind);
  if (!k) return '';
  const name = collapse(label);
  const named = Boolean(name) && !isSelectorLike(name);
  if (!named && !OVERLAY_CONTAINER_RE.test(k)) return '';
  const prep = TAB_CONTAINER_RE.test(k) ? 'on' : 'in';
  return named ? `${prep} the "${truncate(name, MAX_LABEL_LENGTH)}" ${k}` : `${prep} the ${k}`;
}

/**
 * Compact WHERE phrase for a single step — the page route and the UI container the
 * action ran in ("on /settings/users · in the "Create User" modal"). Uses only
 * captured state (document url + nearest container); returns '' when neither is known.
 */
export function describeStepLocation(input: { url?: string; containerLabel?: string; containerKind?: string }): string {
  const route = isApiEndpoint(input.url) ? '' : routePath(input.url);
  const parts: string[] = [];
  if (route) parts.push(`on ${route}`);
  const container = locativeContainer(input.containerLabel, input.containerKind);
  if (container) parts.push(container);
  return parts.join(' · ');
}

/** Render an observed outcome as a trailing clause, or '' when nothing was observed. */
export function describeOutcome(outcome?: ActionOutcome): string {
  if (!outcome) return '';
  const parts: string[] = [];
  if (outcome.navigatedTo) parts.push(`the app moved to ${outcome.navigatedTo}`);
  if (typeof outcome.httpStatus === 'number') parts.push(`the server responded HTTP ${outcome.httpStatus}`);
  if (parts.length === 0 && outcome.domChanged === false) parts.push('nothing on the page changed');
  return parts.length ? `. Result: ${parts.join(', ')}` : '';
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
  if (/^(Open|Go to|Navigate to|Switch to) /i.test(s)) return 'navigation';
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
      return describeRouteStep(record.url);

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
        ? `${describeNetworkSabotage(rawLabel)} (affected request: ${record.payload})`
        : describeNetworkSabotage(rawLabel);

    case 'HOVER':
      return `Hover over ${describeTarget(rawLabel, kind || 'element')}`;

    case 'CLICK':
    default:
      return `Click ${describeTarget(rawLabel, kind || 'element')}`;
  }
}

/**
 * Render an ordered, sequentially-numbered playbook from raw action records, weaving
 * in UI context BEFORE the interactions: the route each action runs on (with explicit
 * transition steps when it changes — child routes, cross-page navigations) and a
 * framing step when the action enters a new named/overlay container. Produces e.g.
 * "Navigate to /settings/users → Open the "Create User" modal → Click the "Save" button".
 */
export function narrateActionRecords(records: ActionRecord[]): string[] {
  const lines: string[] = [];
  let lastRoute = '';
  let lastContainer = '';

  for (const record of records) {
    const route = routePath(record.url);
    const isNav = record.type === 'NAVIGATE' || record.type === 'NAVIGATION';
    // An API endpoint is a request an action fires, never a page to open — never let one
    // seed or transition the playbook's route (the real document URL stays the location).
    const isApi = isApiEndpoint(record.url);

    if (isNav) {
      if (!isApi) {
        lines.push(describeRouteStep(record.url));
        lastRoute = route;
        lastContainer = ''; // a fresh page — any prior container context is gone
      }
      continue;
    }

    // Explicit route transition: this action runs on a different route than the last
    // step (a click that crossed into a child route, or an async fault on a new page).
    if (route && route !== lastRoute && !isApi) {
      lines.push(describeRouteStep(record.url));
      lastRoute = route;
      lastContainer = '';
    }

    // Container framing: entering a new named/overlay container frames the next action
    // and disambiguates one of several identical controls (which "Save" — this modal's).
    const containerKey = `${collapse(record.containerKind)}|${collapse(record.containerLabel)}`;
    const entry = collapse(record.containerKind) ? describeContainerEntry(record.containerLabel, record.containerKind) : '';
    if (entry && containerKey !== lastContainer) {
      lines.push(entry);
      lastContainer = containerKey;
    }

    lines.push(describeActionRecord(record));
  }

  return lines.map((line, index) => `Step ${index + 1}. ${line}`);
}

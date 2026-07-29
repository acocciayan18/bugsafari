// Reproduction-step narration — the single cross-package source of step phrasing.
// Both testing-core (live/history playbooks) and developer-dashboard (forensic
// drawer) render steps through these pure builders so every surface reads in one
// voice. No runtime deps: types only.
const MAX_LABEL_LENGTH = 60;
const MAX_PAYLOAD_LENGTH = 80;
const MAX_NAMED_TARGETS = 5;
const REDACTED = '«redacted»';
const collapse = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
const truncate = (value, max) => value.length > max ? `${value.slice(0, max)}…` : value;
/** Generic structural fallback name for an element — a tag type, never a selector. */
export function genericElementLabel(tagName, type) {
    const tag = (tagName ?? '').toLowerCase();
    const elementType = (type ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select')
        return 'input field';
    if (tag === 'a')
        return 'link';
    if (tag === 'button' || elementType === 'button' || elementType === 'submit')
        return 'button';
    return tag || 'element';
}
/**
 * Most human-actionable label for an element: inner text → aria label → placeholder
 * → name → id → generic tag type. Never returns a raw CSS selector.
 */
export function resolveElementLabel(element) {
    const innerText = collapse(element.innerText);
    if (innerText)
        return truncate(innerText, MAX_LABEL_LENGTH);
    const ariaLabel = collapse(element.ariaLabel);
    if (ariaLabel)
        return truncate(ariaLabel, MAX_LABEL_LENGTH);
    const placeholder = collapse(element.placeholder);
    if (placeholder)
        return truncate(placeholder, MAX_LABEL_LENGTH);
    const name = collapse(element.name);
    if (name)
        return truncate(name, MAX_LABEL_LENGTH);
    const id = collapse(element.id);
    if (id)
        return truncate(id, MAX_LABEL_LENGTH);
    return genericElementLabel(element.tagName, element.type);
}
/**
 * Plain-English noun a developer would use for a control ("button", "link",
 * "email field"). Finer-grained than {@link genericElementLabel}, which stays the
 * structural fallback LABEL; this is the noun the reproduction steps read with.
 */
export function elementNoun(tagName, type) {
    const tag = (tagName ?? '').toLowerCase();
    const elementType = (type ?? '').toLowerCase();
    if (tag === 'a')
        return 'link';
    if (tag === 'select')
        return 'dropdown';
    if (tag === 'textarea')
        return 'text box';
    if (tag === 'button' || elementType === 'button' || elementType === 'submit' || elementType === 'reset') {
        return 'button';
    }
    if (tag === 'input') {
        if (elementType === 'checkbox')
            return 'checkbox';
        if (elementType === 'radio')
            return 'radio button';
        if (elementType === 'file')
            return 'file picker';
        return 'field';
    }
    return tag ? 'control' : 'element';
}
// A raw CSS selector leaked into a label reads as engine noise in the playbook —
// detected here so the step falls back to the control's noun instead.
export function isSelectorLike(value) {
    return /^[#.[]/.test(value) || value.includes(':nth-') || value.includes('>');
}
const GENERIC_FALLBACK = '<element>';
// Concise semantic fallback for an element whose only identity is a raw CSS
// selector — collapses a DOM path to its final control (`<button#submit>`,
// `<input.email-field>`), stripping positional pseudos. Never returns a full path.
export function semanticFallbackFromSelector(selector) {
    const raw = collapse(selector);
    if (!raw)
        return GENERIC_FALLBACK;
    const last = raw.split('>').pop().trim().replace(/:nth-[a-z-]+\([^)]*\)/gi, '');
    const tag = (/^[a-z][a-z0-9-]*/i.exec(last)?.[0] ?? '').toLowerCase();
    const id = /#([\w-]+)/.exec(last)?.[1];
    const cls = /\.([\w-]+)/.exec(last)?.[1];
    const attr = /\[([\w-]+)(?:[~|^$*]?=["']?([^"'\]]+)["']?)?\]/.exec(last);
    const name = attr ? attr[2] ?? attr[1] : undefined;
    const qualifier = id ? `#${id}` : cls ? `.${cls}` : name ? `[${name}]` : '';
    return `<${`${tag}${qualifier}` || 'element'}>`;
}
/**
 * THE resolver every user-facing surface names a control with. Priority: an
 * explicit human label → a semantic fallback distilled from the selector's final
 * segment → the element's tag. Guarantees a structural DOM path never reaches
 * Telemetry, Findings, Forensics, Playbooks, exports, or any API payload.
 */
export function resolveControlName(identity) {
    const label = collapse(identity.label);
    if (label && !isSelectorLike(label))
        return truncate(label, MAX_LABEL_LENGTH);
    const fromSelector = semanticFallbackFromSelector(identity.selector);
    if (fromSelector !== GENERIC_FALLBACK)
        return fromSelector;
    const tag = collapse(identity.tagName).toLowerCase();
    return tag ? `<${tag}>` : GENERIC_FALLBACK;
}
// A structural DOM path inside free text: three-plus selector tokens joined by
// `>`, or a single token carrying a positional pseudo. Case-sensitive, gap-free
// and depth-gated by design, so ordinary prose ("Step 1 > Step 2", "a > b",
// "A → B") is never rewritten.
const DOM_PATH_CHAIN = /(?:[a-z][\w-]*|[#.][\w-]+|\*)(?:[#.][\w-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*(?:\s*>\s*(?:[a-z][\w-]*|[#.][\w-]+|\*)(?:[#.][\w-]+|\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*){2,}/g;
const POSITIONAL_TOKEN = /(?:[a-z][\w-]*|[#.][\w-]+)(?:[#.][\w-]+|\[[^\]]*\])*:nth-[a-z-]+\([^)]*\)/g;
/**
 * Last-mile net for operator-facing free text: rewrites any structural DOM path
 * left in a message to its semantic fallback. Producers should name controls via
 * {@link resolveControlName}; this makes the wire safe regardless of who emits.
 */
export function scrubSelectors(text) {
    return text
        .replace(DOM_PATH_CHAIN, (match) => semanticFallbackFromSelector(match))
        .replace(POSITIONAL_TOKEN, (match) => semanticFallbackFromSelector(match));
}
/** Name one control the way a step should read it — `the "Register" button`. */
export function describeTarget(label, kind) {
    const noun = collapse(kind) || 'element';
    const name = collapse(label);
    return name && !isSelectorLike(name) ? `the "${truncate(name, MAX_LABEL_LENGTH)}" ${noun}` : `the ${noun}`;
}
/** Name a set of controls, capped so a wide burst stays one readable line. */
export function describeTargetList(targets) {
    const named = targets.filter((target) => collapse(target.label) || collapse(target.kind));
    if (named.length === 0)
        return '';
    const shown = named.slice(0, MAX_NAMED_TARGETS).map((target) => describeTarget(target.label, target.kind));
    const hidden = named.length - shown.length;
    if (hidden > 0)
        shown.push(`${hidden} more`);
    if (shown.length === 1)
        return shown[0];
    return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}
// Capitalized element kind for operator-facing descriptions (Button/Input/Link).
function elementKind(tagName, type) {
    const tag = (tagName ?? '').toLowerCase();
    const elementType = (type ?? '').toLowerCase();
    if (tag === 'button' || elementType === 'button' || elementType === 'submit')
        return 'Button';
    if (tag === 'input' || tag === 'textarea' || tag === 'select')
        return 'Input';
    if (tag === 'a')
        return 'Link';
    if (tag)
        return tag.charAt(0).toUpperCase() + tag.slice(1);
    return 'Element';
}
// Label for humanizeElement: text/aria/placeholder/name only (id shown separately).
function resolveDescriptiveLabel(element) {
    const source = collapse(element.innerText) ||
        collapse(element.ariaLabel) ||
        collapse(element.placeholder) ||
        collapse(element.name);
    return source ? truncate(source, MAX_LABEL_LENGTH) : '';
}
/** Readable element description for telemetry/logs — e.g. `Button: "Register" (id: #register-btn)`. */
export function humanizeElement(element) {
    const kind = elementKind(element.tagName, element.type);
    const label = resolveDescriptiveLabel(element);
    const id = collapse(element.id);
    const idPart = id ? ` (id: #${id})` : '';
    return label ? `${kind}: "${label}"${idPart}` : `${kind}${idPart}`;
}
// Redaction-aware payload rendering; truncation lives here only.
function renderPayload(payload, redact) {
    if (!payload)
        return '';
    return redact ? REDACTED : truncate(payload, MAX_PAYLOAD_LENGTH);
}
/** Display form of a payload value for a separate value chip — masked when redacted. */
export function maskPayload(payload, redact) {
    return renderPayload(payload, redact);
}
// ─────────────────────────────────────────────────────────────
// Canonical scenario-step builders (single source of phrasing)
// ─────────────────────────────────────────────────────────────
/**
 * Constraint-stripping / form-bypass step. Names the exact validation attributes
 * removed when known, so a developer sees which guard was defeated on which field.
 */
export function describeConstraintBypass(label, attributes, affectedCount, kind) {
    const target = describeTarget(label, kind ?? 'field');
    const attrs = (attributes ?? []).filter(Boolean);
    if (attrs.length === 0) {
        return `Remove the browser validation from ${target}, then submit the form`;
    }
    const scope = affectedCount && affectedCount > 1 ? ` (and ${affectedCount - 1} more field${affectedCount === 2 ? '' : 's'})` : '';
    return `Remove the ${attrs.join(', ')} validation from ${target}${scope}, then submit the form`;
}
/** Payload-injection step. Redacts auth/password values; truncation lives here only. */
export function describeInputInjection(label, payload, redact, kind) {
    const target = describeTarget(label, kind ?? 'field');
    const value = renderPayload(payload, redact);
    if (collapse(kind) === 'dropdown') {
        return value ? `Select "${value}" from ${target}` : `Choose an option from ${target}`;
    }
    return value ? `Type "${value}" into ${target}` : `Enter a value into ${target}`;
}
/** Single-element zero-wait concurrent burst (ButtonSpammer). */
export function describeConcurrentBurst(outcome, label, kind) {
    return (`Click ${describeTarget(label, kind)} ${outcome.attempted} times as fast as possible ` +
        `(${outcome.completed} of ${outcome.attempted} clicks registered in ${outcome.durationMs}ms)`);
}
/** Multi-sibling zero-wait concurrent burst (InteractionSimulator.concurrentClicker). */
export function describeConcurrentBurstSiblings(outcome, targets) {
    const named = describeTargetList(targets ?? []);
    const list = named ? `: ${named}` : '';
    return (`Click ${outcome.attempted} controls at the same time${list} ` +
        `(${outcome.completed} of ${outcome.attempted} clicks registered in ${outcome.durationMs}ms)`);
}
/**
 * Params-based human description of a replay macro — names the actual elements /
 * dimensions from the stored params so the playbook never shows a vague
 * "Click N sibling elements at once". Live execution metrics (landed/ms) are
 * intentionally omitted; per-step duration is surfaced separately by the renderer.
 */
export function describeReplayMacro(macro) {
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
export function describeCoordinateBombing(count, width, height) {
    return `Click ${count} points spread evenly across the visible area of the ${width}×${height} window`;
}
/** RouteTrasher opening step. */
export function describeRouteTrashStart(repetitions, originPath) {
    return `Starting from ${originPath}, press the browser Back and Forward buttons ${repetitions} times in a row`;
}
// Engine navigation identifiers rendered as what the developer would actually do.
const NAVIGATION_LABELS = {
    rapid_history: 'Rapid Back/Forward presses',
    history_back: 'Pressing browser Back',
    history_forward: 'Pressing browser Forward',
    history_navigation: 'Browser history navigation',
};
/** Plain-English name for an engine navigation identifier. */
export function navigationLabel(navType) {
    return NAVIGATION_LABELS[navType] ?? navType.replace(/_/g, ' ');
}
/** RouteTrasher history back/forward step. `iteration` is 1-based. */
export function describeRouteTrashNavigation(iteration, direction, url) {
    return `Round ${iteration}: press browser ${direction === 'back' ? 'Back' : 'Forward'} → ${url}`;
}
/** RouteTrasher inconsistency: the URL changed but the DOM did not update to match. */
export function describeRouteInconsistency(fromUrl, toUrl) {
    return `The address changed from ${fromUrl} to ${toUrl}, but the page content never updated.`;
}
/** RouteTrasher drift-restore step. */
export function describeRouteTrashDrift(landed, originPath) {
    return `Back/Forward presses ended on ${landed}; returning to ${originPath}.`;
}
/** RouteTrasher: a mutation provoked one or more backend 5xx failures (MEDIUM). */
export function describeRouteTrashServerError(navType, count, url) {
    return `[MEDIUM] ${navigationLabel(navType)} caused ${count} server error(s) (HTTP 5xx) at ${url} — the route or its parameters are likely unvalidated.`;
}
/** RouteTrasher: expected defensive 4xx responses, handled gracefully (INFORMATIONAL). */
export function describeRouteTrashDefensive(navType, count, url) {
    return `[INFO] ${navigationLabel(navType)} was rejected ${count} time(s) with a 4xx response at ${url} — handled correctly, no bug.`;
}
/** RouteTrasher: an unhandled client-side exception fired during a mutation (CRITICAL). */
export function describeRouteTrashClientCrash(navType, count, url) {
    return `[CRITICAL] ${navigationLabel(navType)} caused ${count} unhandled JavaScript error(s) at ${url}.`;
}
/** RouteTrasher: a mutation left the app on a white/blank screen (CRITICAL). */
export function describeRouteTrashWhiteScreen(navType, url) {
    return `[CRITICAL] ${navigationLabel(navType)} left the page blank at ${url} — the view failed to render.`;
}
/** NetworkSaboteur step. */
export function describeNetworkSabotage(mode) {
    return `Make the next API request fail (${collapse(mode).toLowerCase() || 'aborted'}) to test the app's error handling`;
}
/** Navigation traversal step — clicking a navigation control to discover new state. */
export function describeNavigation(label, kind) {
    return `Click ${describeTarget(label, kind ?? 'control')} to reach a new part of the app`;
}
/** Adaptive recovery round after apparent graph exhaustion. */
export function describeRecovery(requeued) {
    return `Retrying ${requeued} unexplored path${requeued === 1 ? '' : 's'} after the app appeared fully explored`;
}
// ─────────────────────────────────────────────────────────────
// Outcome clause + step-kind classification
// ─────────────────────────────────────────────────────────────
/** Render an observed outcome as a trailing clause, or '' when nothing was observed. */
export function describeOutcome(outcome) {
    if (!outcome)
        return '';
    const parts = [];
    if (outcome.navigatedTo)
        parts.push(`the app moved to ${outcome.navigatedTo}`);
    if (typeof outcome.httpStatus === 'number')
        parts.push(`the server responded HTTP ${outcome.httpStatus}`);
    if (parts.length === 0 && outcome.domChanged === false)
        parts.push('nothing on the page changed');
    return parts.length ? ` → ${parts.join(', ')}` : '';
}
/** The step kind for an action record — drives the UI action-type chip. */
export function kindForRecord(type) {
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
export function classifyNarrativeLine(text) {
    const s = text.trim();
    if (/^(Open|Go to) /i.test(s))
        return 'navigation';
    if (/^(Type |Enter a value|Select )/i.test(s))
        return 'input';
    if (/^Remove /i.test(s))
        return 'bypass';
    if (/^(Click|Hover|Press|Starting from)/i.test(s))
        return 'click';
    return 'step';
}
// ─────────────────────────────────────────────────────────────
// Rolling action-buffer narration
// ─────────────────────────────────────────────────────────────
/**
 * Render a single action record WITHOUT a leading "Step N." prefix (numbering is
 * applied by the caller). Appends the observed outcome clause when present.
 */
export function describeActionRecord(record) {
    const base = describeSingleAction(record);
    const repeats = record.repeatCount ?? 1;
    const withRepeat = repeats > 1 ? `${base}, repeated ${repeats} times in quick succession` : base;
    return `${withRepeat}${describeOutcome(record.outcome)}`;
}
function describeSingleAction(record) {
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
export function narrateActionRecords(records) {
    return records.map((record, index) => `Step ${index + 1}. ${describeActionRecord(record)}`);
}

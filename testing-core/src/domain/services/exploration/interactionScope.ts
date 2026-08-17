/**
 * Interaction-scope classifier — the single decision point that splits every
 * ranked element into the two coordinated scopes the data-attack engine drives:
 *
 *  - ATTACK VECTORS  (`attack-vector`): free-text fields (input[type=text|email|
 *    password|search|number|url|tel|date…], textarea). These are payload targets
 *    — dataFuzzer/formBypasser inject context-aware payloads here.
 *  - NAVIGATION / SUPPORTING ELEMENTS: everything required to PROGRESS a form or
 *    workflow so a payload can fully execute:
 *      · `toggle`    — checkbox / radio (must be checked, not typed into)
 *      · `dropdown`  — <select> (must pick a real option, not receive a payload)
 *      · `combo-dropdown` — custom select (role=combobox / aria-haspopup=listbox on a
 *        non-input): opened, then a real option in its popup is clicked, not just the
 *        trigger — so the value changes and the popup is visible in the Live Feed
 *      · `value-control` — range/color (set a native clamped value, not typed into)
 *      · `clickable` — buttons, submit/reset/image inputs, anchors, role=button…
 *      · `file`      — file inputs, driven via setInputFiles with a synthetic file
 *      · `inert`     — hidden inputs that cannot be safely driven and are skipped
 *
 * Pure and deterministic: no DOM, no side effects — trivially unit-testable and
 * reused identically wherever an element must be dispatched to its handler.
 */

export type InteractionScope = 'attack-vector' | 'toggle' | 'dropdown' | 'combo-dropdown' | 'value-control' | 'file' | 'clickable' | 'inert';

/** input[type=…] values that are clicked, never typed into. */
const CLICKABLE_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);

/**
 * input[type=…] constrained value controls: a native range/color widget silently
 * rejects a string fill(), so these are set via a native numeric/hex value rather
 * than fuzzed as text. Kept OUT of attack-vector so number/date keep the text-fuzz
 * boundary path while sliders/color pickers are exercised with valid clamped values.
 */
const VALUE_CONTROL_INPUT_TYPES = new Set(['range', 'color']);

/** input[type=…] values that are toggled (checked), never typed into. */
const TOGGLE_INPUT_TYPES = new Set(['checkbox', 'radio']);

/** input[type=…] values that cannot be safely actuated (not interactive). */
const INERT_INPUT_TYPES = new Set(['hidden']);

/** Minimal element shape needed to route an element to its interaction handler. */
export interface ScopeClassifiable {
  tagName: string;
  type: string;
  role?: string;
  ariaHasPopup?: string;
}

// A non-<select> control that opens a listbox popup: ARIA combobox, or any element
// declaring aria-haspopup=listbox (Radix/MUI/Headless UI/React-Select triggers).
function isComboDropdown(tag: string, role: string, hasPopup: string): boolean {
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
  return role === 'combobox' || hasPopup === 'listbox';
}

/**
 * Resolve which coordinated interaction scope an element belongs to. range/color
 * are constrained value-controls; any other input not explicitly clickable/toggle/
 * value-control/inert (text, email, password, search, number, url, tel, date, or an
 * unknown/absent type) is a fuzzable attack vector; every non-input, non-select
 * control is clickable.
 */
export function classifyInteractionScope(element: ScopeClassifiable): InteractionScope {
  const tag = element.tagName.toLowerCase();
  const type = (element.type ?? '').toLowerCase();
  const role = (element.role ?? '').toLowerCase();
  const hasPopup = (element.ariaHasPopup ?? '').toLowerCase();

  if (tag === 'textarea') return 'attack-vector';
  if (tag === 'select') return 'dropdown';
  if (isComboDropdown(tag, role, hasPopup)) return 'combo-dropdown';

  if (tag === 'input') {
    if (TOGGLE_INPUT_TYPES.has(type)) return 'toggle';
    if (CLICKABLE_INPUT_TYPES.has(type)) return 'clickable';
    if (VALUE_CONTROL_INPUT_TYPES.has(type)) return 'value-control';
    if (type === 'file') return 'file';
    if (INERT_INPUT_TYPES.has(type)) return 'inert';
    return 'attack-vector';
  }

  return 'clickable';
}

/**
 * Additive risk-score boost applied to fuzzable attack vectors when the
 * data-fuzzing gate is active, so the Deep Semantic Data Attack profile
 * prioritizes payload targets over navigation controls. Bounded and additive —
 * the perceptron/heuristic scores are untouched; the loop layers this on top only
 * for data-attack runs.
 */
export const ATTACK_TARGET_SCORE_BOOST = 25;

/** Boost magnitude for an element: {@link ATTACK_TARGET_SCORE_BOOST} for attack vectors, else 0. */
export function attackTargetBoost(element: ScopeClassifiable): number {
  return classifyInteractionScope(element) === 'attack-vector' ? ATTACK_TARGET_SCORE_BOOST : 0;
}

// Session-exit classification moved to the centralized SessionPreservationGuard
// (broadened beyond logout to every session-destroying control). Re-exported here
// so existing call sites keep the original name.
export { isSessionDestroyingControl as isSessionExitControl } from './SessionPreservationGuard.js';

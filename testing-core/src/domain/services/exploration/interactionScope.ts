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
 *      · `clickable` — buttons, submit/reset/image inputs, anchors, role=button…
 *      · `inert`     — file/hidden inputs that cannot be safely driven and are skipped
 *
 * Pure and deterministic: no DOM, no side effects — trivially unit-testable and
 * reused identically wherever an element must be dispatched to its handler.
 */

export type InteractionScope = 'attack-vector' | 'toggle' | 'dropdown' | 'clickable' | 'inert';

/** input[type=…] values that are clicked, never typed into. */
const CLICKABLE_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);

/** input[type=…] values that are toggled (checked), never typed into. */
const TOGGLE_INPUT_TYPES = new Set(['checkbox', 'radio']);

/** input[type=…] values that cannot be safely actuated (native chooser / not interactive). */
const INERT_INPUT_TYPES = new Set(['file', 'hidden']);

/** Minimal element shape needed to route an element to its interaction handler. */
export interface ScopeClassifiable {
  tagName: string;
  type: string;
}

/**
 * Resolve which coordinated interaction scope an element belongs to. Any input
 * whose type is not explicitly clickable/toggle/inert (text, email, password,
 * search, number, url, tel, date, color, range, or an unknown/absent type) is a
 * fuzzable attack vector; every non-input, non-select control is clickable.
 */
export function classifyInteractionScope(element: ScopeClassifiable): InteractionScope {
  const tag = element.tagName.toLowerCase();
  const type = (element.type ?? '').toLowerCase();

  if (tag === 'textarea') return 'attack-vector';
  if (tag === 'select') return 'dropdown';

  if (tag === 'input') {
    if (TOGGLE_INPUT_TYPES.has(type)) return 'toggle';
    if (CLICKABLE_INPUT_TYPES.has(type)) return 'clickable';
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

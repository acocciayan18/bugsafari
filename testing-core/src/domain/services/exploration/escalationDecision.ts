/**
 * Pure payload-escalation decision, extracted from ActionExecutor.executeInputFuzzing
 * so the ladder's advance/reset/hold rule is unit-testable without a Page.
 *
 * Audit A2/A3: escalation used to fire whenever the pre/post DOM hash was equal.
 * The fuzz hasher is deliberately value-blind, so a payload that was ACCEPTED and
 * processed (form re-rendered the same shell, no navigation) hashed identically to
 * the pre-state and escalated the field to L4 almost unconditionally — the ladder
 * measured "did the page navigate", not "did the input resist".
 *
 * The signal is now input resistance:
 *   - fault (≥400 / console-pageerror) or the field vanished → reset to L0 (a real
 *     signal was found, or there is nothing left to probe — restart the ladder).
 *   - the app actively rejected the payload (field no longer holds it, or a client
 *     validation error surfaced) → escalate to a nastier layer next encounter.
 *   - the payload was accepted and processed without a fault → hold the level
 *     (progress, not resistance — do not blindly climb).
 */

export type EscalationOutcome = 'reset' | 'escalate' | 'hold';

export interface EscalationInputs {
  /** The fuzzed field still exists in the DOM after inject + submit. */
  fieldStillPresent: boolean;
  /** A real fault fired this step (≥400 API response or a console/page error). */
  faulted: boolean;
  /** The app resisted the payload: it was not retained, or a client validation error surfaced. */
  resisted: boolean;
}

export function decideEscalation(inputs: EscalationInputs): EscalationOutcome {
  if (!inputs.fieldStillPresent || inputs.faulted) return 'reset';
  if (inputs.resisted) return 'escalate';
  return 'hold';
}

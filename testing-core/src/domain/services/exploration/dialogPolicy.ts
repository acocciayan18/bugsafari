import { synthesizeEscalatedPayload, deriveFuzzSeed } from '../../scenarios/fuzzing/payloadEscalator.js';

// Native-dialog policy (audit P3-03).
//
// Every dialog used to be dismissed unconditionally, so confirm() always returned
// false. The scorer deliberately ranks destructive controls highest (destroy 92,
// delete 86, pay 78) and the loop even emits a "high-impact action detected"
// milestone — and then the effect was cancelled every single time. Consequences:
// the whole class of state-mutating defects behind a confirmation was unreachable,
// the cancelled click looked like a no-op so the control was penalised AND marked
// covered, and prompt() was a real input surface the fuzzer could never reach.
//
// Deciding this is an exploration concern, not a monitor detail, so the rule lives
// here as a pure function the monitor consults.

export type DialogDecision = 'accept' | 'dismiss';

export interface DialogVerdict {
  decision: DialogDecision;
  /** Text handed to an accepted prompt(); empty for every other dialog type. */
  promptText: string;
  /** Human-readable justification, recorded as a reproduction step. */
  reason: string;
}

/**
 * Deterministic payload for a prompt(), drawn from the same escalation pipeline
 * that feeds text fields — the dialog message is the identity, so a given prompt
 * replays with the same value.
 */
export function promptPayloadFor(message: string): string {
  const key = `dialog:${message}`.slice(0, 200);
  return synthesizeEscalatedPayload('TEXT_SEARCH', 0, deriveFuzzSeed(key, 'TEXT_SEARCH')).value;
}

/**
 * Decide what to do with a native dialog.
 *
 * - `beforeunload` is always dismissed: accepting it abandons the page and throws
 *   away the state the run is exploring.
 * - `readOnly` is the operator's escape hatch for running against an environment
 *   where destructive branches must not execute — it restores the old behaviour.
 * - `prompt` is accepted WITH a payload so the input surface is actually exercised.
 * - `alert` / `confirm` are accepted so the branch behind them runs.
 */
export function decideDialog(type: string, message: string, readOnly: boolean): DialogVerdict {
  if (type === 'beforeunload') {
    return { decision: 'dismiss', promptText: '', reason: 'beforeunload kept the page (accepting would abandon the run state)' };
  }
  if (readOnly) {
    return { decision: 'dismiss', promptText: '', reason: `read-only run — cancelled the ${type} dialog` };
  }
  if (type === 'prompt') {
    const promptText = promptPayloadFor(message);
    return { decision: 'accept', promptText, reason: `answered the prompt with "${promptText}"` };
  }
  return { decision: 'accept', promptText: '', reason: `confirmed the ${type} dialog so the branch behind it executes` };
}

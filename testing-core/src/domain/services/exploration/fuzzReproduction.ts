// Pure builder for a confirmed fuzz-leak's replayable trace. The fuzz engine
// injects a payload AND submits the form to reach the backend, so the reproduction
// must be navigate → type → submit: a keystroke alone sends nothing, so a value that
// stops at "type" reflects/errors nothing and cannot be reproduced by a developer.
import type { ActionRecord } from '../../../../../shared/types.js';

export interface FuzzReproductionInput {
  timestamp: string;
  pageUrl: string;
  selector: string;
  payload: string;
  elementLabel: string;
  elementKind: string;
  redactValue: boolean;
}

export function buildFuzzReproductionActions(input: FuzzReproductionInput): ActionRecord[] {
  const { timestamp, pageUrl, selector, payload, elementLabel, elementKind, redactValue } = input;
  return [
    { timestamp, type: 'NAVIGATE', selector: pageUrl, url: pageUrl },
    { timestamp, type: 'INPUT', selector, url: pageUrl, payload, elementLabel, elementKind, redactValue },
    { timestamp, type: 'FORM_SUBMIT', selector, url: pageUrl },
  ];
}

import assert from 'node:assert/strict';
import { actionRecordsToSteps } from './reproduction.js';
import type { ActionRecord } from './types/bug.js';

// Self-executing script (no runner). Locks FIX-3: a record flagged redactValue must
// NOT persist its payload text — redaction is a persist-time guarantee, not just a
// render-time mask. Fuzz records (redactValue false) keep the value for replay.

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }

function record(over: Partial<ActionRecord>): ActionRecord {
  return { timestamp: '2026-08-30T00:00:00.000Z', type: 'INPUT', selector: '#f', url: 'https://t/app', ...over };
}

console.log('reproduction redactValue — FIX-3');

check('redactValue:true drops the persisted payloadText', () => {
  const [step] = actionRecordsToSteps([record({ payload: 'hunter2secret', redactValue: true })]);
  assert.equal(step.payloadText, undefined, 'credential value must not be persisted');
});

check('redactValue:false keeps the payload for replay', () => {
  const [step] = actionRecordsToSteps([record({ payload: "'; DROP--", redactValue: false })]);
  assert.equal(step.payloadText, "'; DROP--", 'fuzz payload preserved for replay');
});

check('undefined redactValue behaves as not-redacted', () => {
  const [step] = actionRecordsToSteps([record({ payload: 'plainvalue' })]);
  assert.equal(step.payloadText, 'plainvalue', 'default keeps value');
});

console.log(`\nreproduction redactValue: ${passed} checks passed.`);

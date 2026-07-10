// Standalone deterministic tests for the pure payload-escalation decision (audit
// A2/A3: escalation was confounded by the value-blind DOM hash). Run via
// `npm test` or `npx tsx .../escalationDecision.test.ts`.

import assert from 'node:assert/strict';
import { decideEscalation } from './escalationDecision.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('escalationDecision — input-resistance-driven ladder (A2/A3 fix)');

check('a fault resets the ladder to L0', () => {
  assert.equal(decideEscalation({ fieldStillPresent: true, faulted: true, resisted: true }), 'reset');
  assert.equal(decideEscalation({ fieldStillPresent: true, faulted: true, resisted: false }), 'reset');
});

check('a vanished field resets the ladder to L0', () => {
  assert.equal(decideEscalation({ fieldStillPresent: false, faulted: false, resisted: true }), 'reset');
});

check('genuine resistance (payload rejected / client error) escalates', () => {
  assert.equal(decideEscalation({ fieldStillPresent: true, faulted: false, resisted: true }), 'escalate');
});

check('an accepted-and-processed payload with no fault HOLDS — the A2 false-escalation fix', () => {
  // Previously this hashed identical (value-blind) and wrongly escalated to L4.
  assert.equal(decideEscalation({ fieldStillPresent: true, faulted: false, resisted: false }), 'hold');
});

check('fault dominates resistance (reset wins over escalate)', () => {
  assert.equal(decideEscalation({ fieldStillPresent: true, faulted: true, resisted: true }), 'reset');
});

console.log(`\nescalationDecision: ${passed} checks passed.`);

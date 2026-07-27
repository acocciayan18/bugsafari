// Standalone deterministic tests for the pure payload-escalation decision (audit
// A2/A3: escalation was confounded by the value-blind DOM hash). Run via
// `npm test` or `npx tsx .../escalationDecision.test.ts`.

import assert from 'node:assert/strict';
import { decideEscalation, resolveResistance } from './escalationDecision.js';

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

console.log('\nresolveResistance — delivery-corroborated acceptance (P3-02 fix)');

const accepted = { resisted: false, reason: 'payload accepted' };
const rejected = { resisted: true, reason: 'payload not retained' };

check('a retained payload the app never reacted to is NOT acceptance', () => {
  // The P3-02 self-confirming false negative: direct `.value` writes always read
  // back as retained, so every field reported "well validated" and never escalated.
  const verdict = resolveResistance({ fieldStillPresent: true, payloadDelivered: true, dom: accepted, appReacted: false });
  assert.equal(verdict.resisted, true);
  assert.equal(verdict.reason, 'no observable delivery');
});

check('a retained payload with an observable app reaction holds as accepted', () => {
  const verdict = resolveResistance({ fieldStillPresent: true, payloadDelivered: true, dom: accepted, appReacted: true });
  assert.deepEqual(verdict, accepted);
});

check('a field that refused the value is resistance regardless of reaction', () => {
  const verdict = resolveResistance({ fieldStillPresent: true, payloadDelivered: false, dom: accepted, appReacted: true });
  assert.equal(verdict.resisted, true);
  assert.equal(verdict.reason, 'field rejected the payload');
});

check('an explicit DOM rejection keeps its own reason', () => {
  const verdict = resolveResistance({ fieldStillPresent: true, payloadDelivered: true, dom: rejected, appReacted: false });
  assert.deepEqual(verdict, rejected);
});

check('a vanished field defers to the caller reset path, never to escalation', () => {
  const dom = { resisted: false, reason: 'field vanished' };
  const verdict = resolveResistance({ fieldStillPresent: false, payloadDelivered: false, dom, appReacted: false });
  assert.deepEqual(verdict, dom);
});

console.log(`\nescalationDecision: ${passed} checks passed.`);

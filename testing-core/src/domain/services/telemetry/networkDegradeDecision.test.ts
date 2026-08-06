// Deterministic checks for the browser-view degradation streak policy. No unit-test
// runner is configured, so run with
// `npx tsx src/domain/services/telemetry/networkDegradeDecision.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { initialDegradeState, onTargetFailure, onTargetSuccess } from './networkDegradeDecision.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('networkDegradeDecision — target-origin transport-failure streak');

check('a single failure below threshold does not degrade', () => {
  const r = onTargetFailure(initialDegradeState(), 3);
  assert.equal(r.enterDegraded, false);
  assert.equal(r.state.degraded, false);
  assert.equal(r.state.consecutiveFailures, 1);
});

check('degrades exactly once on reaching the streak threshold', () => {
  let s = initialDegradeState();
  let entered = 0;
  for (let i = 0; i < 5; i += 1) {
    const r = onTargetFailure(s, 3);
    s = r.state;
    if (r.enterDegraded) entered += 1;
  }
  assert.equal(entered, 1, 'enterDegraded fires only on the transition');
  assert.equal(s.degraded, true);
});

check('a success between failures resets the streak (no degrade)', () => {
  let s = initialDegradeState();
  s = onTargetFailure(s, 3).state;
  s = onTargetFailure(s, 3).state;
  s = onTargetSuccess(s).state; // recovery before the third failure
  const r = onTargetFailure(s, 3);
  assert.equal(r.enterDegraded, false, 'streak restarted after the success');
  assert.equal(r.state.consecutiveFailures, 1);
});

check('success while degraded exits degraded exactly once', () => {
  let s = initialDegradeState();
  s = onTargetFailure(s, 2).state;
  s = onTargetFailure(s, 2).state; // now degraded
  assert.equal(s.degraded, true);
  const first = onTargetSuccess(s);
  assert.equal(first.exitDegraded, true, 'first success lifts degraded');
  const second = onTargetSuccess(first.state);
  assert.equal(second.exitDegraded, false, 'already healthy — no repeat exit');
});

console.log(`\n${passed} checks passed`);

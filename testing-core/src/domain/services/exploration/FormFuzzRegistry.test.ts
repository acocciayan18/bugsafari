// Standalone deterministic tests for FormFuzzRegistry's per-form fuzz cap.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/FormFuzzRegistry.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { FormFuzzRegistry } from './FormFuzzRegistry.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('FormFuzzRegistry — per-form fuzz-attempt budget');

check('attempts accumulate and hit the cap of 2', () => {
  const r = new FormFuzzRegistry();
  assert.equal(r.isExhausted('form#login', 2), false);
  assert.equal(r.recordAttempt('form#login'), 1);
  assert.equal(r.isExhausted('form#login', 2), false);
  assert.equal(r.recordAttempt('form#login'), 2);
  assert.equal(r.isExhausted('form#login', 2), true);
});

check('distinct forms track independently', () => {
  const r = new FormFuzzRegistry();
  r.recordAttempt('form#a');
  r.recordAttempt('form#a');
  assert.equal(r.isExhausted('form#a', 2), true);
  assert.equal(r.isExhausted('form#b', 2), false);
});

check('empty key and cap<=0 disable the cap', () => {
  const r = new FormFuzzRegistry();
  assert.equal(r.recordAttempt(''), 0);
  assert.equal(r.isExhausted('', 2), false);
  r.recordAttempt('form#x');
  r.recordAttempt('form#x');
  assert.equal(r.isExhausted('form#x', 0), false);
});

check('reset clears all counters', () => {
  const r = new FormFuzzRegistry();
  r.recordAttempt('form#x');
  r.recordAttempt('form#x');
  r.reset();
  assert.equal(r.attemptCount('form#x'), 0);
  assert.equal(r.isExhausted('form#x', 2), false);
});

console.log(`\n${passed} checks passed.`);

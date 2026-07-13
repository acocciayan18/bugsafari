// Standalone deterministic tests for NetworkFailureCascadeTracker's rolling
// failure-burst detection. No unit-test runner is configured in this package,
// so this is a self-executing script: run with
// `npx tsx src/domain/services/exploration/NetworkFailureCascadeTracker.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { NetworkFailureCascadeTracker } from './NetworkFailureCascadeTracker.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('NetworkFailureCascadeTracker — rolling failure-burst detection');

check('no failures recorded is never cascading', () => {
  const t = new NetworkFailureCascadeTracker(2000, 5);
  assert.equal(t.isCascading(0), false);
});

check('fewer failures than the threshold is not cascading', () => {
  const t = new NetworkFailureCascadeTracker(2000, 5);
  t.recordFailure(0);
  t.recordFailure(100);
  t.recordFailure(200);
  t.recordFailure(300);
  assert.equal(t.isCascading(300), false);
});

check('threshold failures within the window IS cascading', () => {
  const t = new NetworkFailureCascadeTracker(2000, 5);
  t.recordFailure(0);
  t.recordFailure(100);
  t.recordFailure(200);
  t.recordFailure(300);
  t.recordFailure(400);
  assert.equal(t.isCascading(400), true);
});

check('failures outside the rolling window age out and stop counting', () => {
  const t = new NetworkFailureCascadeTracker(2000, 5);
  t.recordFailure(0);
  t.recordFailure(100);
  t.recordFailure(200);
  t.recordFailure(300);
  t.recordFailure(400);
  assert.equal(t.isCascading(2500), false);
});

check('a fresh burst after the window clears re-triggers cascade detection', () => {
  const t = new NetworkFailureCascadeTracker(2000, 5);
  for (let i = 0; i < 5; i++) t.recordFailure(i * 10);
  assert.equal(t.isCascading(40), true);
  // Advance well past the window — old failures age out.
  assert.equal(t.isCascading(5000), false);
  for (let i = 0; i < 5; i++) t.recordFailure(5000 + i * 10);
  assert.equal(t.isCascading(5040), true);
});

check('reset() clears all recorded failures', () => {
  const t = new NetworkFailureCascadeTracker(2000, 5);
  for (let i = 0; i < 5; i++) t.recordFailure(i * 10);
  t.reset();
  assert.equal(t.isCascading(40), false);
});

check('custom threshold of 3 requires only three failures within the window', () => {
  const t = new NetworkFailureCascadeTracker(1500, 3);
  t.recordFailure(0);
  t.recordFailure(50);
  const before = t.isCascading(50);
  t.recordFailure(100);
  assert.equal(before, false);
  assert.equal(t.isCascading(100), true);
});

console.log(`\nNetworkFailureCascadeTracker: ${passed} checks passed.`);

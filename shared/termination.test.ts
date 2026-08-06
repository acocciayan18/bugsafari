// Self-executing checks for the run-termination taxonomy. No test framework (per the
// "no external libraries" rule) — discovered by shared/scripts/run-tests.mjs.
// Locks the ENGINE_ERROR terminal outcome that keeps engine/environment failures
// distinct from a Crashed target application across every surface.

import assert from 'node:assert/strict';
import { TERMINATION_COPY, describeTermination, isCleanTermination } from './types/termination.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('engine-error has its own operator copy', () => {
  assert.equal(TERMINATION_COPY['engine-error'].label, 'Engine Error');
});

check('engine-error is NOT a clean termination', () => {
  assert.equal(isCleanTermination('engine-error'), false);
});

check('engine-error is distinct from a target-app crash (exception)', () => {
  assert.notEqual(TERMINATION_COPY['engine-error'].label, TERMINATION_COPY.exception.label);
});

check('describeTermination renders the engine-error reason', () => {
  const out = describeTermination('engine-error', 'page.goto: Timeout 20000ms exceeded.');
  assert.match(out, /Engine Error: page\.goto: Timeout 20000ms exceeded\./);
});

console.log(`\n${passed} termination checks passed.`);

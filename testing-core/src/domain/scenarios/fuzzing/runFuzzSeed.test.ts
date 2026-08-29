// Self-executing tests for the run-scoped fuzz salt. Run via:
//   npx tsx src/domain/scenarios/fuzzing/runFuzzSeed.test.ts

import assert from 'node:assert/strict';
import { setFuzzRunSeed, resetFuzzRunSeed, currentFuzzRunSeed, saltFieldSeed } from './runFuzzSeed.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('runFuzzSeed — per-run salt');

check('unset salt is 0 and passes the seed through unchanged', () => {
  resetFuzzRunSeed();
  assert.equal(currentFuzzRunSeed(), 0);
  assert.equal(saltFieldSeed(12345), 12345);
});

check('setFuzzRunSeed folds into the seed (XOR)', () => {
  setFuzzRunSeed(0x0f0f0f0f);
  assert.equal(currentFuzzRunSeed(), 0x0f0f0f0f);
  assert.equal(saltFieldSeed(0), 0x0f0f0f0f);
  assert.equal(saltFieldSeed(0x0f0f0f0f), 0);
});

check('two distinct salts produce distinct salted seeds', () => {
  setFuzzRunSeed(111);
  const a = saltFieldSeed(999);
  setFuzzRunSeed(222);
  const b = saltFieldSeed(999);
  assert.notEqual(a, b);
});

check('reset restores the base seed (no stale salt leaks forward)', () => {
  setFuzzRunSeed(0xdeadbeef);
  resetFuzzRunSeed();
  assert.equal(currentFuzzRunSeed(), 0);
  assert.equal(saltFieldSeed(777), 777);
});

check('output is an unsigned 32-bit int', () => {
  setFuzzRunSeed(0xffffffff);
  const v = saltFieldSeed(0x00000001);
  assert.ok(v >= 0 && v <= 0xffffffff && Number.isInteger(v));
  resetFuzzRunSeed();
});

console.log(`\nrunFuzzSeed: ${passed} checks passed.`);

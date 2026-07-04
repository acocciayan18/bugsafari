// Standalone deterministic tests for the O(1) ring-buffer implementation.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/lib/circularBuffer.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { CircularBuffer } from './circularBuffer.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('CircularBuffer — fixed-capacity ring buffer');

check('snapshot preserves insertion order below capacity', () => {
  const b = new CircularBuffer<number>(3);
  b.push(1);
  b.push(2);
  assert.deepEqual(b.snapshot(), [1, 2]);
});

check('overflow evicts oldest, keeps last N in order (wrap-around)', () => {
  const b = new CircularBuffer<number>(3);
  for (const n of [1, 2, 3, 4, 5]) b.push(n);
  assert.deepEqual(b.snapshot(), [3, 4, 5]);
});

check('continued wrapping stays correct across multiple laps', () => {
  const b = new CircularBuffer<string>(2);
  for (const s of ['a', 'b', 'c', 'd', 'e']) b.push(s);
  assert.deepEqual(b.snapshot(), ['d', 'e']);
});

check('clear resets to empty', () => {
  const b = new CircularBuffer<number>(3);
  b.push(1);
  b.push(2);
  b.clear();
  assert.deepEqual(b.snapshot(), []);
});

console.log(`\nCircularBuffer: ${passed} checks passed.`);

// Standalone deterministic tests for the ReproductionProbe backpressure policy: under a
// fault storm the bounded queue must serve high-severity findings first and never let a
// CRITICAL be tail-dropped behind low-severity work.
// Run via `npm test` or `npx tsx .../ReproductionProbe.priority.test.ts`.

import assert from 'node:assert/strict';
import type { FaultSeverity } from '../../../../../shared/types.js';
import { highestSeverityIndex, lowestSeverityIndex, shouldEvictFor } from './ReproductionProbe.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const q = (...s: FaultSeverity[]): { severity: FaultSeverity }[] => s.map((severity) => ({ severity }));

console.log('ReproductionProbe — severity-aware backpressure');

check('empty queue has no highest/lowest', () => {
  assert.equal(highestSeverityIndex([]), -1);
  assert.equal(lowestSeverityIndex([]), -1);
});

check('drain picks the highest severity', () => {
  assert.equal(highestSeverityIndex(q('LOW', 'CRITICAL', 'MEDIUM')), 1);
});

check('ties resolve to the earliest (FIFO within a severity)', () => {
  assert.equal(highestSeverityIndex(q('HIGH', 'LOW', 'HIGH')), 0);
  assert.equal(lowestSeverityIndex(q('MEDIUM', 'LOW', 'LOW')), 1);
});

check('eviction victim is the lowest severity', () => {
  assert.equal(lowestSeverityIndex(q('HIGH', 'INFO', 'MEDIUM')), 1);
});

check('a CRITICAL evicts a queue full of LOWs', () => {
  assert.equal(shouldEvictFor(q('LOW', 'LOW', 'LOW'), 'CRITICAL'), true);
});

check('a LOW does not evict a queue of HIGHs (newcomer is dropped instead)', () => {
  assert.equal(shouldEvictFor(q('HIGH', 'HIGH', 'CRITICAL'), 'LOW'), false);
});

check('equal severity does not evict — first-come holds its slot', () => {
  assert.equal(shouldEvictFor(q('MEDIUM', 'MEDIUM'), 'MEDIUM'), false);
});

console.log(`\nReproductionProbe: ${passed} checks passed.`);

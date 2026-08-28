// Self-executing checks for the deterministic family representative. Guards that the
// live buffer collapse and the saved-history collapse pick the SAME survivor from the
// same content, so an operator's live reproduction steps equal the saved report's.
// Run with `npx tsx "shared/faultRepresentative.test.ts"`.

import assert from 'node:assert/strict';
import { compareFaultRepresentatives, pickFaultRepresentative, type RepresentativeFault } from './faultRepresentative.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const id = (f: RepresentativeFault): RepresentativeFault => f;

check('the richest reproduction wins, regardless of input order', () => {
  const rich: RepresentativeFault = { reproductionSteps: ['a', 'b', 'c'], timestamp: 100 };
  const thin: RepresentativeFault = { reproductionSteps: ['a'], timestamp: 1 };
  assert.strictEqual(pickFaultRepresentative([thin, rich], id), rich);
  assert.strictEqual(pickFaultRepresentative([rich, thin], id), rich);
});

check('equal step count falls back to the earliest sighting', () => {
  const early: RepresentativeFault = { reproductionSteps: ['a', 'b'], timestamp: 10 };
  const late: RepresentativeFault = { reproductionSteps: ['x', 'y'], timestamp: 99 };
  assert.strictEqual(pickFaultRepresentative([late, early], id), early);
  assert.strictEqual(pickFaultRepresentative([early, late], id), early);
});

check('identical content yields an order-independent, stable choice', () => {
  const a: RepresentativeFault = { reproductionSteps: ['same'], timestamp: 5 };
  const b: RepresentativeFault = { reproductionSteps: ['same'], timestamp: 5 };
  assert.deepStrictEqual(pickFaultRepresentative([a, b], id).reproductionSteps, pickFaultRepresentative([b, a], id).reproductionSteps);
});

check('the comparator is a total order (never depends on argument order)', () => {
  const x: RepresentativeFault = { reproductionSteps: ['a', 'b'], timestamp: 3 };
  const y: RepresentativeFault = { reproductionSteps: ['a'], timestamp: 1 };
  assert.ok(compareFaultRepresentatives(x, y) < 0 && compareFaultRepresentatives(y, x) > 0);
});

console.log(`\nfaultRepresentative.test.ts: ${passed} checks passed`);

// Standalone tests for the concurrent-burst ambiguity gate (pure, browser-free).
// Run: `npx tsx src/domain/services/exploration/culpritAmbiguity.test.ts`.

import assert from 'node:assert/strict';
import { isConcurrentBurstAt, type ActedEntry } from './culpritAmbiguity.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const e = (selector: string, actedAtMs: number): ActedEntry => ({ selector, actedAtMs });

console.log('culpritAmbiguity — concurrent-burst detection');

check('a single control acted near the request is NOT ambiguous', () => {
  assert.equal(isConcurrentBurstAt([e('#compute', 1000)], 1010), false);
});

check('the SAME control clicked twice (a double-submit) is NOT ambiguous', () => {
  assert.equal(isConcurrentBurstAt([e('#pay', 1000), e('#pay', 1040)], 1050), false);
});

check('four distinct controls fired near-simultaneously IS ambiguous', () => {
  const burst = [e('#soft-fail', 1000), e('#place-order', 1015), e('#home', 1030), e('#back', 1045)];
  assert.equal(isConcurrentBurstAt(burst, 1020), true);
});

check('a second distinct control OUTSIDE the window does not make it ambiguous', () => {
  // #other was clicked 300ms before the request start — a separate, earlier action.
  assert.equal(isConcurrentBurstAt([e('#other', 700), e('#login', 1000)], 1010), false);
});

check('window boundary is inclusive', () => {
  assert.equal(isConcurrentBurstAt([e('#a', 1000), e('#b', 1120)], 1000, 120), true);
  assert.equal(isConcurrentBurstAt([e('#a', 1000), e('#b', 1121)], 1000, 120), false);
});

check('empty history and a non-finite instant never throw or flag', () => {
  assert.equal(isConcurrentBurstAt([], 1000), false);
  assert.equal(isConcurrentBurstAt([e('#a', 1000), e('#b', 1000)], Number.NaN), false);
});

console.log(`\n${passed} passed`);

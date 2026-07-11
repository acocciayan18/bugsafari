// Standalone deterministic tests for EdgeRepeatTracker's session-wide
// structural-transition repeat budget. No unit-test runner is configured in this
// package, so this is a self-executing script: run with
// `npx tsx src/domain/services/exploration/EdgeRepeatTracker.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { EdgeRepeatTracker } from './EdgeRepeatTracker.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('EdgeRepeatTracker — session-wide transition-repeat budget');

check('non-productive repeats accumulate and hit the budget', () => {
  const t = new EdgeRepeatTracker();
  assert.equal(t.isExhausted('S', 'a.nav', 3), false);
  assert.equal(t.recordRepeat('S', 'a.nav'), 1);
  assert.equal(t.recordRepeat('S', 'a.nav'), 2);
  assert.equal(t.isExhausted('S', 'a.nav', 3), false);
  assert.equal(t.recordRepeat('S', 'a.nav'), 3);
  assert.equal(t.isExhausted('S', 'a.nav', 3), true);
});

check('a productive traversal clears the accumulated repeats', () => {
  const t = new EdgeRepeatTracker();
  t.recordRepeat('S', 'a.nav');
  t.recordRepeat('S', 'a.nav');
  t.recordProductive('S', 'a.nav'); // reached a novel structure — reset
  assert.equal(t.repeatCount('S', 'a.nav'), 0);
  assert.equal(t.isExhausted('S', 'a.nav', 3), false);
});

check('counters are keyed per (structure, selector)', () => {
  const t = new EdgeRepeatTracker();
  t.recordRepeat('S1', 'a.nav');
  t.recordRepeat('S1', 'a.nav');
  assert.equal(t.repeatCount('S2', 'a.nav'), 0); // different shell
  assert.equal(t.repeatCount('S1', 'b.nav'), 0); // different control
});

check('budget <= 0 disables the cap entirely', () => {
  const t = new EdgeRepeatTracker();
  t.recordRepeat('S', 'a.nav');
  t.recordRepeat('S', 'a.nav');
  t.recordRepeat('S', 'a.nav');
  assert.equal(t.isExhausted('S', 'a.nav', 0), false);
});

check('empty structure/selector are ignored (no phantom keys)', () => {
  const t = new EdgeRepeatTracker();
  assert.equal(t.recordRepeat('', 'a.nav'), 0);
  assert.equal(t.recordRepeat('S', ''), 0);
  assert.equal(t.repeatCount('', ''), 0);
});

console.log(`\nEdgeRepeatTracker: ${passed} checks passed.`);

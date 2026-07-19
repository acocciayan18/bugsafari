// Standalone deterministic tests for StateClusterRegistry's page-saturation layer
// (structural-shell Fully-Explored detection + frontier pruning). No unit-test
// runner is configured in this package, so this is a self-executing script: run
// with `npx tsx src/domain/services/exploration/StateClusterRegistry.saturation.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateClusterRegistry } from './StateClusterRegistry.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateClusterRegistry — page saturation');

check('coverage-complete saturates the shell regardless of caps', () => {
  const r = new StateClusterRegistry({ maxVisits: 0, maxInteractions: 0 });
  r.observe('S', '/p', ['a', 'b'], 1);
  assert.equal(r.isSaturated('S'), false);
  r.markTriggered('S', 'a', 2);
  assert.equal(r.isSaturated('S'), false); // b still untriggered
  r.markTriggered('S', 'b', 3);
  assert.equal(r.isSaturated('S'), true); // all discovered triggered
});

check('gain-less revisits saturate at maxVisits; a coverage gain resets the counter', () => {
  const r = new StateClusterRegistry({ maxVisits: 3, maxInteractions: 0 });
  r.observe('S', '/p', ['a', 'b'], 1); // first visit discovers → gain, counter 0
  r.observe('S', '/p', ['a', 'b'], 2); // no new control → 1
  r.observe('S', '/p', ['a', 'b'], 3); // 2
  assert.equal(r.isSaturated('S'), false);
  r.markTriggered('S', 'a', 3); // real coverage gain resets visitsSinceGain
  r.observe('S', '/p', ['a', 'b'], 4); // 1 again
  r.observe('S', '/p', ['a', 'b'], 5); // 2
  r.observe('S', '/p', ['a', 'b'], 6); // 3 → saturated
  assert.equal(r.isSaturated('S'), true);
});

check('repeat actuations saturate at the relative churn cap; distinct triggers do not', () => {
  // Interaction cap scales with discovered-control count: max(maxInteractions, discovered).
  // Here discovered=4 > maxInteractions=3, so the effective churn bound is 4.
  const r = new StateClusterRegistry({ maxVisits: 0, maxInteractions: 3 });
  r.observe('S', '/p', ['a', 'b', 'c', 'd'], 1);
  r.markTriggered('S', 'a', 1);
  r.markTriggered('S', 'b', 2);
  r.markTriggered('S', 'c', 3); // three DISTINCT triggers — no redundancy
  assert.equal(r.isSaturated('S'), false);
  r.markTriggered('S', 'a', 4); // repeat 1
  r.markTriggered('S', 'a', 5); // repeat 2
  r.markTriggered('S', 'a', 6); // repeat 3 — still below the relative cap of 4
  assert.equal(r.isSaturated('S'), false);
  r.markTriggered('S', 'a', 7); // repeat 4 → saturated (churn bound = discovered count)
  assert.equal(r.isSaturated('S'), true);
});

check('saturated shells are pruned from the unexplored frontier', () => {
  const r = new StateClusterRegistry({ maxVisits: 2, maxInteractions: 0 });
  r.observe('S', '/p', ['a', 'b'], 1); // discovered a,b (none triggered) → gain, 0
  assert.equal(r.hasUnexploredControls(), true);
  assert.equal(r.unexploredControlCount(), 2);
  r.observe('S', '/p', ['a', 'b'], 2); // 1
  r.observe('S', '/p', ['a', 'b'], 3); // 2 → saturated by visit cap
  assert.equal(r.isSaturated('S'), true);
  assert.equal(r.hasUnexploredControls(), false); // leftover controls no longer count
  assert.equal(r.unexploredControlCount(), 0);
  assert.equal(r.saturatedClusterCount(), 1);
});

check('caps of 0 disable saturation entirely (coverage never completes here)', () => {
  const r = new StateClusterRegistry({ maxVisits: 0, maxInteractions: 0 });
  r.observe('S', '/p', ['a', 'b'], 1);
  for (let i = 2; i < 20; i++) r.observe('S', '/p', ['a', 'b'], i); // many gain-less revisits
  for (let i = 0; i < 20; i++) r.markTriggered('S', 'a', i); // many repeat actuations
  assert.equal(r.isSaturated('S'), false); // b untriggered + both caps disabled
});

check('unknown / empty shells are never saturated', () => {
  const r = new StateClusterRegistry();
  assert.equal(r.isSaturated('never-seen'), false);
  assert.equal(r.isSaturated(''), false);
});

console.log(`\nStateClusterRegistry: ${passed} checks passed.`);

// Standalone deterministic tests for the node lifecycle (Discovered → Analyzing →
// Testing → Completed / Skipped) and the "completed/skipped never re-tested"
// fast-path, plus configurable RouteTrasher budget edges (0 disables, 1/2 caps).
// Self-executing script (no runner is configured): run with
// `npx tsx src/domain/services/StateGraphNavigator.lifecycle.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateGraphNavigator — node lifecycle & configurable budget');

check('configurable budget: 0 disables, 1 caps after one, 2 caps after two', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  // budget 0 → never allowed
  assert.equal(nav.canRouteMutate('s0', 0), false);
  // budget 1 → allowed once, then disabled
  assert.equal(nav.canRouteMutate('s1', 1), true);
  nav.registerRouteMutation('s1');
  assert.equal(nav.canRouteMutate('s1', 1), false);
  // budget 2 → allowed twice, then disabled
  assert.equal(nav.canRouteMutate('s2', 2), true);
  nav.registerRouteMutation('s2');
  assert.equal(nav.canRouteMutate('s2', 2), true);
  nav.registerRouteMutation('s2');
  assert.equal(nav.canRouteMutate('s2', 2), false);
});

// Scores are kept above the max boredom threshold (40) so the decision kind is
// driven by the lifecycle fast-path, not by boredom-backtracking.
check('a single-edge state completes and a revisit is never re-tested (no explore-edge)', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  // First visit: the sole edge is picked (explore-edge) and marked traversing.
  const first = nav.registerStateAndDecide('leaf', 'http://x/leaf', [{ selector: '#only', score: 80 }]);
  assert.equal(first.kind, 'explore-edge');
  // Confirm the traversal so the only edge becomes 'explored' → node completes.
  nav.confirmEdgeTraversal('leaf', '#only', 'child');
  // Re-arrive at the same completed state: the fast-path must NOT return explore-edge
  // (so no scenario re-execution) — it unwinds via backtrack/exhausted instead.
  const second = nav.registerStateAndDecide('leaf', 'http://x/leaf', [{ selector: '#only', score: 80 }]);
  assert.notEqual(second.kind, 'explore-edge');
});

check('a fresh state with unvisited edges still explores (fast-path only fires when terminal)', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  const d = nav.registerStateAndDecide('n', 'http://x/n', [
    { selector: '#a', score: 70 },
    { selector: '#b', score: 80 },
  ]);
  assert.equal(d.kind, 'explore-edge');
  // Re-arrive before completion: another unvisited control remains → still explores.
  const d2 = nav.registerStateAndDecide('n', 'http://x/n', [
    { selector: '#a', score: 70 },
    { selector: '#b', score: 80 },
  ]);
  assert.equal(d2.kind, 'explore-edge');
});

console.log(`\nStateGraphNavigator lifecycle: ${passed} checks passed.`);

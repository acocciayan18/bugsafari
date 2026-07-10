// Standalone deterministic tests for StateGraphNavigator's per-state RouteTrasher
// mutation budget (canRouteMutate / registerRouteMutation / penalizeRouteBranch /
// bestUnvisitedSelector / exploredEdgeSelectors). No unit-test runner is configured
// in this package, so this is a self-executing script: run with
// `npx tsx src/domain/services/StateGraphNavigator.routeBudget.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateGraphNavigator — per-state RouteTrasher mutation budget');

check('canRouteMutate is true below the limit and false once it is reached', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  const h = 'state-a';
  assert.equal(nav.canRouteMutate(h, 3), true);
  assert.equal(nav.registerRouteMutation(h), 1);
  assert.equal(nav.registerRouteMutation(h), 2);
  assert.equal(nav.canRouteMutate(h, 3), true); // count 2 < 3 → still allowed
  assert.equal(nav.registerRouteMutation(h), 3);
  assert.equal(nav.canRouteMutate(h, 3), false); // count 3 ≥ 3 → disabled
  assert.equal(nav.routeMutationCount(h), 3);
});

check('mutation budgets are tracked independently per state node', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  nav.registerRouteMutation('n1');
  nav.registerRouteMutation('n1');
  nav.registerRouteMutation('n1');
  assert.equal(nav.canRouteMutate('n1', 3), false);
  assert.equal(nav.canRouteMutate('n2', 3), true); // untouched node unaffected
});

check('penalizeRouteBranch returns true once, then false (idempotent)', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  assert.equal(nav.penalizeRouteBranch('state-b'), true);
  assert.equal(nav.penalizeRouteBranch('state-b'), false);
});

check('bestUnvisitedSelector returns the highest-scoring UNVISITED control', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  // registerStateAndDecide picks the argmax edge (#b, 50) and marks it traversing,
  // so the best remaining unvisited control is #c (30).
  nav.registerStateAndDecide('n1', 'http://x/home', [
    { selector: '#a', score: 10 },
    { selector: '#b', score: 50 },
    { selector: '#c', score: 30 },
  ]);
  assert.equal(nav.bestUnvisitedSelector('n1'), '#c');
});

check('exploredEdgeSelectors reflects the churn (explored/blocked) edges only', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  nav.registerStateAndDecide('n1', 'http://x/home', [
    { selector: '#a', score: 10 },
    { selector: '#b', score: 50 },
  ]);
  // #b was picked (traversing) — not yet explored.
  assert.deepEqual(nav.exploredEdgeSelectors('n1'), []);
  nav.confirmEdgeTraversal('n1', '#b', 'child-hash');
  assert.deepEqual(nav.exploredEdgeSelectors('n1'), ['#b']);
  // The unvisited frontier control is still surfaced for prioritization.
  assert.equal(nav.bestUnvisitedSelector('n1'), '#a');
});

check('unknown state nodes yield safe empty/null reads', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  assert.equal(nav.bestUnvisitedSelector('nope'), null);
  assert.deepEqual(nav.exploredEdgeSelectors('nope'), []);
  assert.equal(nav.routeMutationCount('nope'), 0);
});

console.log(`\nStateGraphNavigator routeBudget: ${passed} checks passed.`);

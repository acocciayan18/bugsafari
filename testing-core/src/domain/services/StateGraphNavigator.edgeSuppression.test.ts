import assert from 'node:assert';
import { StateGraphNavigator } from './StateGraphNavigator.js';
import type { PathfinderElement } from './DIrectedPathFinder.js';

// Look-Ahead Edge Suppression: a nav (anchor) edge whose destination is already
// saturated must be skipped before it is ever actuated, and the suppression
// logged — while a same-selector NON-nav control is never suppressed.

const nav = (selector: string, score: number): PathfinderElement => ({
  selector,
  score,
  elementType: 'a',
});

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  console.log(`  ✓ ${name}`);
  passed++;
};

// Deterministic: no softmax sampling. exploration mode explores a below-threshold
// unvisited edge instead of backtracking, so the live link is actually selected.
const navi = new StateGraphNavigator({ mode: 'exploration', explorationEnabled: false });

// Step 1 @ home: two nav edges. Pick the higher (link-dead), traverse to DEAD.
let d = navi.registerStateAndDecide('home', 'http://x/home', [nav('link-dead', 90), nav('link-live', 10)]);
assert.equal(d.kind, 'explore-edge');
assert.equal((d as { selector: string }).selector, 'link-dead');
navi.confirmEdgeTraversal('home', 'link-dead', 'dead');

// Step 2 @ DEAD: single edge; explore it, then it becomes exhausted → saturated.
d = navi.registerStateAndDecide('dead', 'http://x/dead', [nav('only', 50)]);
navi.confirmEdgeTraversal('dead', 'only', 'leaf');
// Land back on dead: its one edge is explored → node completes (saturated).
d = navi.registerStateAndDecide('dead', 'http://x/dead', [nav('only', 50)]);
check('destination "dead" is now saturated', navi.isStateSaturated('dead'));

// A DIFFERENT node also exposes link-dead (a shared navbar link) as a fresh edge.
d = navi.registerStateAndDecide('other', 'http://x/other', [nav('link-dead', 90), nav('link-live', 10)]);
check('suppressed nav edge is not selected — picks the live link instead',
  d.kind === 'explore-edge' && (d as { selector: string }).selector === 'link-live');
check('look-ahead flags link-dead destination saturated', navi.isNavDestinationSaturated('link-dead'));
check('a suppression event was logged',
  navi.recentEvents(50).some((e) => e.kind === 'edge-suppressed' && e.detail.includes('link-dead')));

// Non-nav control sharing the selector must NOT be suppressed (anchor-only).
const navi2 = new StateGraphNavigator({ explorationEnabled: false });
navi2.registerStateAndDecide('a', 'http://y/a', [{ selector: 'btn', score: 40, elementType: 'button' }]);
check('non-nav selector is never look-ahead suppressed', !navi2.isNavDestinationSaturated('btn'));

console.log(`\nStateGraphNavigator edge-suppression: ${passed} checks passed.`);

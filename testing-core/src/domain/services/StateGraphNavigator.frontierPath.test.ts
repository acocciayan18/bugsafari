// Standalone tests for the global scored frontier (novelty-weighted priority)
// and the BFS shortest-path plan attached to backtrack decisions.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/StateGraphNavigator.frontierPath.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';
import type { BacktrackDecision } from './DIrectedPathFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateGraphNavigator — global scored frontier + BFS path planning');

// Deterministic probe base: softmax off, boredom floor below any positive score.
const BASE = {
  mode: 'probe' as const,
  explorationSeed: 42,
  explorationEnabled: false,
  adaptiveBoredom: false,
  boredomThreshold: 1,
  globalFrontierBacktrack: true,
  frontierNoveltyWeight: 10,
};

const H = 'fpH'; // hub
const A = 'fpA'; // child holding a stranded unvisited edge
const B = 'fpB'; // child with an explored edge back to the hub
const hubEdges = [
  { selector: 'hA', score: 5 },
  { selector: 'hB', score: 4 },
];

const nav = new StateGraphNavigator(BASE);

// Step 1: at H, take hA → A.
const d1 = nav.registerStateAndDecide(H, 'http://x/h', hubEdges);
assert.equal(d1.kind, 'explore-edge');
assert.equal((d1 as { selector: string }).selector, 'hA');
nav.confirmEdgeTraversal(H, 'hA', A);

// Step 2: at A, a forced backtrack strands its unvisited edge a2.
const d2 = nav.registerStateAndDecide(A, 'http://x/a', [{ selector: 'a2', score: 2 }], true);

check('forced backtrack resolves via the global frontier with a priority breakdown', () => {
  assert.equal(d2.kind, 'backtrack');
  const bt = d2 as BacktrackDecision;
  assert.equal(bt.targetHash, H);
  assert.ok(bt.frontier, 'frontier metadata missing');
  // H visited once → novelty bonus 10/(1+1)=5; best unvisited edge hB=4 → priority 9.
  assert.equal(bt.frontier!.selector, 'hB');
  assert.equal(bt.frontier!.edgeScore, 4);
  assert.equal(bt.frontier!.noveltyBonus, 5);
  assert.equal(bt.frontier!.priority, 9);
  // A has no explored outgoing edges — no BFS route to H exists yet.
  assert.equal(bt.path, undefined);
});

// Step 3: back at H, take the remaining hB → B.
const d3 = nav.registerStateAndDecide(H, 'http://x/h', hubEdges);
assert.equal(d3.kind, 'explore-edge');
assert.equal((d3 as { selector: string }).selector, 'hB');
nav.confirmEdgeTraversal(H, 'hB', B);

// Step 4: B links back to the hub — explored edge bH → H.
const d4 = nav.registerStateAndDecide(B, 'http://x/b', [{ selector: 'bH', score: 1 }]);
assert.equal(d4.kind, 'explore-edge');
nav.confirmEdgeTraversal(B, 'bH', H);

// Step 5: back at H with every hub edge explored → dead end. The global frontier
// picks A (stranded a2, priority 2 + 10/(1+1) = 7) and BFS plans H —hA→ A.
const d5 = nav.registerStateAndDecide(H, 'http://x/h', hubEdges);

check('dead end jumps to the highest-priority stranded frontier node', () => {
  assert.equal(d5.kind, 'backtrack');
  const bt = d5 as BacktrackDecision;
  assert.equal(bt.targetHash, A);
  assert.equal(bt.frontier!.selector, 'a2');
  assert.equal(bt.frontier!.priority, 7);
});

check('a BFS shortest action path is attached when an explored route exists', () => {
  const bt = d5 as BacktrackDecision;
  assert.ok(bt.path, 'expected a planned path');
  assert.equal(bt.path!.length, 1);
  assert.equal(bt.path![0].selector, 'hA');
  assert.equal(bt.path![0].fromHash, H);
  assert.equal(bt.path![0].toHash, A);
});

check('after the jump, the stranded edge is explored', () => {
  const d6 = nav.registerStateAndDecide(A, 'http://x/a', [{ selector: 'a2', score: 2 }]);
  assert.equal(d6.kind, 'explore-edge');
  assert.equal((d6 as { selector: string }).selector, 'a2');
});

check('frontier selections are logged to the pathfinder event stream', () => {
  const kinds = nav.recentEvents(50).map((e) => e.kind);
  assert.ok(kinds.includes('frontier-selected'), 'no frontier-selected event recorded');
});

console.log(`\n${passed} passed`);

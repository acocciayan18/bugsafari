// Characterization test for StateGraphNavigator — a behavior-preservation safety
// net written BEFORE splitting this 1295-line class into pathfinder/* submodules
// (Phase 5, task 19). There is no prior test coverage for this class at all, so
// this pins the exact decision sequence/snapshot values observed from the
// PRE-SPLIT implementation using a deterministic config (seeded PRNG, exploration
// and adaptive-boredom disabled so softmax sampling can't introduce nondeterminism).
// Re-run after EVERY extraction step in the split — any deviation is a real
// regression, not a new-and-improved behavior.
//
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/domain/services/StateGraphNavigator.characterization.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateGraphNavigator — characterization (pre-split behavior pin)');

// Deterministic config: seeded PRNG, no softmax sampling, static (non-adaptive)
// boredom floor low enough that any positive-score edge clears it.
const DETERMINISTIC_CONFIG = {
  mode: 'probe' as const,
  explorationSeed: 12345,
  explorationEnabled: false,
  adaptiveBoredom: false,
  boredomThreshold: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: explore-edge → explore-edge → backtrack → explore-edge → exhausted
// A 2-child root (R: a1=50, a2=30) with one grandchild chain (R -a1-> C1 -b1-> C2),
// where C2 has no elements (dead end), forcing a backtrack to R's remaining edge
// a2, and finally exhaustion once every edge on every node is explored.
// ─────────────────────────────────────────────────────────────────────────────

const nav = new StateGraphNavigator(DETERMINISTIC_CONFIG);
const R = 'hashR';
const C1 = 'hashC1';
const C2 = 'hashC2';
const C3 = 'hashC3';
const rootElements = [
  { selector: 'a1', score: 50 },
  { selector: 'a2', score: 30 },
];

const d1 = nav.registerStateAndDecide(R, 'http://x/r', rootElements);
check('step 1: explores best-scored edge (a1) on the fresh root node', () => {
  assert.equal(d1.kind, 'explore-edge');
  assert.equal((d1 as { selector: string }).selector, 'a1');
  assert.equal((d1 as { score: number }).score, 50);
});
if (d1.kind === 'explore-edge') nav.confirmEdgeTraversal(R, d1.selector, C1);

const d2 = nav.registerStateAndDecide(C1, 'http://x/c1', [{ selector: 'b1', score: 40 }]);
check('step 2: explores the only edge on the new child node', () => {
  assert.equal(d2.kind, 'explore-edge');
  assert.equal((d2 as { selector: string }).selector, 'b1');
});
if (d2.kind === 'explore-edge') nav.confirmEdgeTraversal(C1, d2.selector, C2);

const d3 = nav.registerStateAndDecide(C2, 'http://x/c2', []);
check('step 3: dead end (no elements) backtracks to root\'s remaining edge', () => {
  assert.equal(d3.kind, 'backtrack');
  assert.equal((d3 as { targetHash: string }).targetHash, R);
  assert.equal((d3 as { targetUrl: string }).targetUrl, 'http://x/r');
});

const d4 = nav.registerStateAndDecide(R, 'http://x/r', rootElements);
check('step 4: explores root\'s last remaining edge (a2) after backtrack', () => {
  assert.equal(d4.kind, 'explore-edge');
  assert.equal((d4 as { selector: string }).selector, 'a2');
  assert.equal((d4 as { score: number }).score, 30);
});
if (d4.kind === 'explore-edge') nav.confirmEdgeTraversal(R, d4.selector, C3);

const d5 = nav.registerStateAndDecide(R, 'http://x/r', rootElements);
check('step 5: every edge on every node explored — graph reports exhausted', () => {
  assert.equal(d5.kind, 'exhausted');
});

check('final snapshot matches the pinned pre-split values', () => {
  assert.deepEqual(nav.snapshot(), {
    nodeCount: 3,
    edgeCount: 3,
    stackDepth: 0,
    currentHash: 'none',
    consecutiveRepeats: 2,
  });
  assert.equal(nav.getBoredomThreshold(), 1);
  assert.deepEqual(nav.ancestorUrls(), []);
  assert.equal(nav.nodeCount(), 3);
  assert.equal(nav.edgeCount(), 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: markEdgeUnstable → markEdgeCyclic → blockCurrentBranch →
// recoverFromExhaustion, exercising the mutators Scenario 1 never touches.
// ─────────────────────────────────────────────────────────────────────────────

const nav2 = new StateGraphNavigator({ ...DETERMINISTIC_CONFIG, explorationSeed: 999 });
const X = 'hashX';
const xElements = [
  { selector: 'x1', score: 50 },
  { selector: 'x2', score: 40 },
  { selector: 'x3', score: 30 },
];

const e1 = nav2.registerStateAndDecide(X, 'http://x/x', xElements);
check('e1: explores the best-scored edge (x1)', () => {
  assert.equal(e1.kind, 'explore-edge');
  assert.equal((e1 as { selector: string }).selector, 'x1');
});
if (e1.kind === 'explore-edge') nav2.markEdgeUnstable(X, e1.selector);

const e2 = nav2.registerStateAndDecide(X, 'http://x/x', xElements);
check('e2: unstable edge (below retry limit) is re-queued with a score penalty, so x2 now wins', () => {
  assert.equal(e2.kind, 'explore-edge');
  assert.equal((e2 as { selector: string }).selector, 'x2');
  assert.equal((e2 as { score: number }).score, 40);
});
if (e2.kind === 'explore-edge') nav2.markEdgeCyclic(X, e2.selector);

nav2.blockCurrentBranch();
const e3 = nav2.registerStateAndDecide(X, 'http://x/x', xElements);
check('e3: blockCurrentBranch blocks all remaining edges — node reports exhausted', () => {
  assert.equal(e3.kind, 'exhausted');
});

const recovery = nav2.recoverFromExhaustion();
check('recoverFromExhaustion re-queues the two soft-blocked edges but never the cyclic one', () => {
  assert.deepEqual(recovery, { requeuedEdges: 2, nodesReopened: 1 });
});

const e4 = nav2.registerStateAndDecide(X, 'http://x/x', xElements);
check('e4: after recovery, x3 (never touched) is the highest-scoring open edge', () => {
  assert.equal(e4.kind, 'explore-edge');
  assert.equal((e4 as { selector: string }).selector, 'x3');
  assert.equal((e4 as { score: number }).score, 30);
});

check('scenario 2 final snapshot matches the pinned pre-split values', () => {
  assert.deepEqual(nav2.snapshot(), {
    nodeCount: 1,
    edgeCount: 3,
    stackDepth: 1,
    currentHash: 'hashX',
    consecutiveRepeats: 1,
  });
});

console.log(`\nStateGraphNavigator characterization: ${passed} checks passed.`);

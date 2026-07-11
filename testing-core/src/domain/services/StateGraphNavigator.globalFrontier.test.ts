// Standalone tests for the global best-first frontier jump (globalFrontierBacktrack).
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/StateGraphNavigator.globalFrontier.test.ts`.
// Exits non-zero on the first failed assertion.
//
// Both scenarios drive the IDENTICAL sequence; only the flag differs:
//   flag ON  → when the breadcrumb stack empties, jump to the highest-scoring
//              unvisited edge stranded on an already-popped branch (C1.e3=100).
//   flag OFF → the same empty stack reports `exhausted` (pre-change behaviour).

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateGraphNavigator — global best-first frontier');

// Probe base (deterministic, softmax off, boredom floor below any positive score),
// so the ONLY behavioural difference between the two runs is the frontier flag.
const BASE = {
  mode: 'probe' as const,
  explorationSeed: 12345,
  explorationEnabled: false,
  adaptiveBoredom: false,
  boredomThreshold: 1,
};

const R = 'gfR';
const C1 = 'gfC1';
const C2 = 'gfC2';
// R's two edges; e1 is taken first, then we FORCE-backtrack off C1 leaving its
// high-value edge e3 unexplored, then drain R's e2 into a dead end so the stack
// empties with e3 still stranded on the (now popped) C1 branch.
const rootEdges = [
  { selector: 'e1', score: 5 },
  { selector: 'e2', score: 4 },
];

function driveToEmptyStack(nav: StateGraphNavigator) {
  // Step 1: at R, take e1 → C1.
  const d1 = nav.registerStateAndDecide(R, 'http://x/r', rootEdges);
  assert.equal(d1.kind, 'explore-edge');
  assert.equal((d1 as { selector: string }).selector, 'e1');
  nav.confirmEdgeTraversal(R, 'e1', C1);

  // Step 2: at C1, a high-value edge e3=100 exists, but a forced backtrack unwinds
  // to R's remaining edge — leaving e3 unexplored on the soon-to-be-popped branch.
  const d2 = nav.registerStateAndDecide(C1, 'http://x/c1', [{ selector: 'e3', score: 100 }], true);
  assert.equal(d2.kind, 'backtrack');
  assert.equal((d2 as { targetHash: string }).targetHash, R);

  // Step 3: back at R, take the last edge e2 → C2.
  const d3 = nav.registerStateAndDecide(R, 'http://x/r', rootEdges);
  assert.equal(d3.kind, 'explore-edge');
  assert.equal((d3 as { selector: string }).selector, 'e2');
  nav.confirmEdgeTraversal(R, 'e2', C2);

  // Step 4: C2 is a dead end (no elements). R has no edges left → stack empties.
  return nav.registerStateAndDecide(C2, 'http://x/c2', []);
}

// ── Scenario A: flag ON — global jump to the stranded high-value edge ──────────
const navOn = new StateGraphNavigator({ ...BASE, globalFrontierBacktrack: true });
const onStep4 = driveToEmptyStack(navOn);

check('flag ON: empty stack jumps to the off-branch node holding the best edge (C1)', () => {
  assert.equal(onStep4.kind, 'backtrack');
  assert.equal((onStep4 as { targetHash: string }).targetHash, C1);
  assert.equal((onStep4 as { targetUrl: string }).targetUrl, 'http://x/c1');
});

check('flag ON: after the jump, C1 explores its stranded high-value edge e3', () => {
  const d5 = navOn.registerStateAndDecide(C1, 'http://x/c1', [{ selector: 'e3', score: 100 }]);
  assert.equal(d5.kind, 'explore-edge');
  assert.equal((d5 as { selector: string }).selector, 'e3');
  assert.equal((d5 as { score: number }).score, 100);
});

// ── Scenario B: flag OFF — identical drive terminates as exhausted ─────────────
const navOff = new StateGraphNavigator({ ...BASE, globalFrontierBacktrack: false });
const offStep4 = driveToEmptyStack(navOff);

check('flag OFF: identical sequence reports exhausted (pre-change behaviour preserved)', () => {
  assert.equal(offStep4.kind, 'exhausted');
});

console.log(`\n${passed} passed`);

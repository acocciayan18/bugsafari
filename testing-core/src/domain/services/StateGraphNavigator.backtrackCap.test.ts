// Standalone deterministic test for the ancestor return-cap (maxBacktracksToNode):
// a node exploration keeps BACKTRACKING (restoring) TO is a stagnation trap and,
// past the cap, has its frontier blocked and is excluded from future backtracking
// instead of being restored to forever. No unit-test runner is configured in this
// package, so this is a self-executing script: run with
// `npx tsx src/domain/services/StateGraphNavigator.backtrackCap.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';
import type { PathfinderElement, PathfinderDecision } from './DIrectedPathFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StateGraphNavigator — ancestor return-cap (stagnation trap)');

// Deterministic config: fixed cap, no softmax/boredom noise, probe honours backtracks.
const cfg = {
  maxBacktracksToNode: 3,
  explorationEnabled: false,
  adaptiveBoredom: false,
  boredomThreshold: 0,
  mode: 'probe' as const,
};

// A hub R whose every child is an immediate dead-end (empty state). Each dead-end
// unwinds to R; R keeps offering unvisited edges. Without the cap this restores to
// R once per edge; with the cap R is closed after maxBacktracksToNode returns.
const RURL = 'https://app.test/hub';
const hubEdges: PathfinderElement[] = Array.from({ length: 8 }, (_, i) => ({
  selector: `#e${i}`,
  score: 100 - i, // strictly descending so picks are deterministic
  elementType: 'BUTTON',
}));

check('a node backtracked-to past the cap is blocked and excluded from backtracking', () => {
  const nav = new StateGraphNavigator(cfg);

  // 1. Enter the hub — expect an explore decision on its top edge.
  const first = nav.registerStateAndDecide('R', RURL, hubEdges);
  assert.equal(first.kind, 'explore-edge', 'hub should first explore an edge');

  let backtracksToR = 0;
  let finalKind: PathfinderDecision['kind'] = first.kind;

  // Drive dead-end children until the navigator stops backtracking to R.
  for (let i = 0; i < hubEdges.length + 2; i++) {
    // Land on a fresh empty child state → immediate dead-end, unwinds toward R.
    const deadEnd = nav.registerStateAndDecide(`C${i}`, `${RURL}/c${i}`, []);
    if (deadEnd.kind === 'exhausted') {
      finalKind = 'exhausted';
      break;
    }
    assert.equal(deadEnd.kind, 'backtrack', 'empty child must backtrack');
    assert.equal(deadEnd.targetHash, 'R', 'backtrack target should be the hub R');
    backtracksToR += 1;
    // Engine restores to R; re-register to pick the next unvisited edge.
    const back = nav.registerStateAndDecide('R', RURL, hubEdges);
    if (back.kind === 'exhausted') {
      finalKind = 'exhausted';
      break;
    }
  }

  // Exactly maxBacktracksToNode restorations to R are allowed, then it is capped.
  assert.equal(backtracksToR, cfg.maxBacktracksToNode, 'restorations to R capped at maxBacktracksToNode');
  assert.equal(finalKind, 'exhausted', 'after the cap the graph unwinds to exhausted, not another restore to R');

  // R is now terminal: a revisit is never re-tested (no explore-edge), and its
  // frontier is closed despite unvisited edges having remained at cap time.
  const revisit = nav.registerStateAndDecide('R', RURL, hubEdges);
  assert.notEqual(revisit.kind, 'explore-edge', 'capped hub must not be re-explored on revisit');
});

console.log(`\nStateGraphNavigator backtrack-cap: ${passed} checks passed.`);

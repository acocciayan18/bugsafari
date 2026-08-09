// Global-frontier route dead-end exclusion + barren-stagnation escape strategy.
// Self-executing script (no runner configured): run with
// `npx tsx src/domain/services/StateGraphNavigator.frontier.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { StateGraphNavigator } from './StateGraphNavigator.js';
import { routeKey } from '../../ml/domHasher.js';
import type { PathfinderDecision } from './DIrectedPathFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const targetHash = (d: PathfinderDecision): string | undefined =>
  (d as { targetHash?: string }).targetHash;

console.log('StateGraphNavigator — frontier dead-end exclusion & escape strategy');

check('markRouteDeadEnd excludes that route from the frontier; clearRouteDeadEnd re-admits it', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  // P: best unvisited edge #p2 (85) outscores Q's best unvisited #q2 (45).
  nav.registerStateAndDecide('P', 'http://x/p', [
    { selector: '#p1', score: 90 },
    { selector: '#p2', score: 85 },
    { selector: '#p3', score: 80 },
  ]);
  nav.registerStateAndDecide('Q', 'http://x/q', [
    { selector: '#q1', score: 55 },
    { selector: '#q2', score: 45 },
  ]);

  // Baseline: a dead end resolves to the highest-scoring frontier — route /p.
  const base = nav.markStructuralDeadEnd('d1', 'http://x/d1');
  assert.equal(base.kind, 'backtrack');
  assert.equal(targetHash(base), 'P');

  // Mark /p a dead end → the frontier must skip it and fall to route /q.
  nav.markRouteDeadEnd(routeKey('http://x/p'));
  const excluded = nav.markStructuralDeadEnd('d2', 'http://x/d2');
  assert.equal(targetHash(excluded), 'Q');

  // Revival: clearing the mark re-admits /p, which outscores /q again.
  nav.clearRouteDeadEnd(routeKey('http://x/p'));
  const readmitted = nav.markStructuralDeadEnd('d3', 'http://x/d3');
  assert.equal(targetHash(readmitted), 'P');
});

check('enterEscapeMode switches the frontier to novelty-first; noteProgress reverts to score-first', () => {
  const nav = new StateGraphNavigator({ explorationEnabled: false });
  // P registered twice → higher visitCount; still holds an unvisited edge #p3 (80).
  nav.registerStateAndDecide('P', 'http://x/p', [
    { selector: '#p1', score: 90 },
    { selector: '#p2', score: 85 },
    { selector: '#p3', score: 80 },
  ]);
  nav.registerStateAndDecide('P', 'http://x/p', [
    { selector: '#p1', score: 90 },
    { selector: '#p2', score: 85 },
    { selector: '#p3', score: 80 },
  ]);
  // Q registered once → lower visitCount; best unvisited #q2 (45).
  nav.registerStateAndDecide('Q', 'http://x/q', [
    { selector: '#q1', score: 55 },
    { selector: '#q2', score: 45 },
  ]);

  // Score-first exploit: /p (80) beats /q (45).
  assert.equal(targetHash(nav.markStructuralDeadEnd('d1', 'http://x/d1')), 'P');

  // Escape mode (empty cooldown after noteProgress) → novelty-first: the
  // least-visited node Q wins despite its lower edge score.
  nav.noteProgress();
  nav.enterEscapeMode();
  assert.equal(targetHash(nav.markStructuralDeadEnd('d2', 'http://x/d2')), 'Q');

  // Progress leaves escape mode → score-first again picks /p.
  nav.noteProgress();
  assert.equal(targetHash(nav.markStructuralDeadEnd('d3', 'http://x/d3')), 'P');
});

console.log(`\nStateGraphNavigator frontier: ${passed} checks passed.`);

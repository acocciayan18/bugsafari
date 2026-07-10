// Standalone deterministic tests for the pure novelty-reward rule extracted from
// ExplorationLoop.applyNoveltyRewardAndTelemetry(). Run via the package test
// runner (`npm test`) or directly: `npx tsx .../noveltyScoring.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { isNovelStructuralState } from './noveltyScoring.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('noveltyScoring — structure-gated novelty reward (false-novelty loop fix)');

check('a verified traversal to a brand-new shell IS novel', () => {
  const novel = isNovelStructuralState({
    traversalOk: true,
    landedInvalid: false,
    childStructure: 'shell-NEW',
    visitedStructures: new Set(['shell-home']),
  });
  assert.equal(novel, true);
});

check('returning to an already-seen shell is NOT novel (the guru99 reload loop)', () => {
  // #submitBtn reloads the same home page: combined hash churns from volatile
  // ad/label content, but the structure shell repeats — must not be rewarded.
  const novel = isNovelStructuralState({
    traversalOk: true,
    landedInvalid: false,
    childStructure: 'shell-home',
    visitedStructures: new Set(['shell-home']),
  });
  assert.equal(novel, false);
});

check('a no-op traversal is never novel', () => {
  const novel = isNovelStructuralState({
    traversalOk: false,
    landedInvalid: false,
    childStructure: 'shell-NEW',
    visitedStructures: new Set(['shell-home']),
  });
  assert.equal(novel, false);
});

check('an invalid-context landing (about:blank / crash) is never novel', () => {
  const novel = isNovelStructuralState({
    traversalOk: true,
    landedInvalid: true,
    childStructure: 'shell-NEW',
    visitedStructures: new Set(['shell-home']),
  });
  assert.equal(novel, false);
});

check('the very first observation of a shell is novel (empty visited set)', () => {
  const novel = isNovelStructuralState({
    traversalOk: true,
    landedInvalid: false,
    childStructure: 'shell-home',
    visitedStructures: new Set(),
  });
  assert.equal(novel, true);
});

console.log(`\nnoveltyScoring: ${passed} checks passed.`);

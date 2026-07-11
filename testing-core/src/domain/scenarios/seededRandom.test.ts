// Standalone deterministic tests for the shared scenario RNG. No unit-test runner
// is configured in this package, so this is a self-executing script: run with
// `npx tsx src/domain/scenarios/seededRandom.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { seedScenarioRandom, scenarioRandom, scenarioPick, isScenarioRandomSeeded } from './seededRandom.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('seededRandom — reproducible scenario/fuzz randomness');

check('same seed reproduces the identical sequence', () => {
  seedScenarioRandom(12345);
  const a = [scenarioRandom(), scenarioRandom(), scenarioRandom()];
  seedScenarioRandom(12345);
  const b = [scenarioRandom(), scenarioRandom(), scenarioRandom()];
  assert.deepEqual(a, b);
});

check('different seeds diverge', () => {
  seedScenarioRandom(1);
  const a = scenarioRandom();
  seedScenarioRandom(2);
  const b = scenarioRandom();
  assert.notEqual(a, b);
});

check('scenarioPick is deterministic under a fixed seed', () => {
  const arr = ['xss', 'sql', 'nosql', 'json', 'date'] as const;
  seedScenarioRandom(777);
  const picksA = [scenarioPick(arr), scenarioPick(arr), scenarioPick(arr), scenarioPick(arr)];
  seedScenarioRandom(777);
  const picksB = [scenarioPick(arr), scenarioPick(arr), scenarioPick(arr), scenarioPick(arr)];
  assert.deepEqual(picksA, picksB);
});

check('all draws stay in [0,1)', () => {
  seedScenarioRandom(42);
  for (let i = 0; i < 1000; i++) {
    const r = scenarioRandom();
    assert.ok(r >= 0 && r < 1, `out of range: ${r}`);
  }
});

check('seed mode flag reflects seeded vs unseeded state', () => {
  seedScenarioRandom(5);
  assert.equal(isScenarioRandomSeeded(), true);
  seedScenarioRandom(undefined);
  assert.equal(isScenarioRandomSeeded(), false);
});

check('unseeded mode falls back to non-deterministic Math.random', () => {
  seedScenarioRandom(undefined);
  // Two consecutive draws being equal is astronomically unlikely — smoke-checks
  // the fallback path is live (not frozen on a stale seeded state).
  const distinct = new Set([scenarioRandom(), scenarioRandom(), scenarioRandom()]);
  assert.ok(distinct.size > 1);
});

console.log(`\n${passed} passed`);

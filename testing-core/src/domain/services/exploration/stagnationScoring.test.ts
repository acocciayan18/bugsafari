// Standalone deterministic tests for the pure stagnation-scoring formula
// extracted from ExplorationLoop.execute(). No unit-test runner is configured
// in this package, so this is a self-executing script: run with
// `npx tsx src/domain/services/exploration/stagnationScoring.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { computeStagnation, computePenaltyIntensity, computePenaltyWindow } from './stagnationScoring.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('stagnationScoring — adaptive compound-hash stagnation formula');

check('novel state (no repeat, no familiarity, no coverage stall) scores 0', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-Z',
    recentStructures: [],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: false,
  });
  assert.equal(result.combinedRepeated, false);
  assert.equal(result.structureFamiliarity, 0);
  assert.equal(result.stagnationScore, 0);
  assert.deepEqual(result.nextRecentStructures, ['shell-1']);
  assert.equal(result.nextPreviousCombined, 'hash-A');
});

check('exact-repeat combined hash contributes 2 to the score', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-A',
    recentStructures: [],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: false,
  });
  assert.equal(result.combinedRepeated, true);
  assert.equal(result.stagnationScore, 2);
});

check('structural familiarity contributes 1 per prior occurrence in the window', () => {
  const result = computeStagnation({
    currentHash: 'hash-B',
    previousCombined: 'hash-A',
    recentStructures: ['shell-1', 'shell-1', 'shell-2'],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: false,
  });
  assert.equal(result.combinedRepeated, false);
  assert.equal(result.structureFamiliarity, 2);
  assert.equal(result.stagnationScore, 2);
});

check('coverage stall adds exactly 1 regardless of hash/structure repetition', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-Z',
    recentStructures: [],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: true,
  });
  assert.equal(result.stagnationScore, 1);
});

check('coverage stall at the threshold (no extra depth) still adds exactly 1 (backward compatible)', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-Z',
    recentStructures: [],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: true,
    coverageStallSteps: 0, // exactly at the window — same as omitting it
  });
  assert.equal(result.stagnationScore, 1);
});

check('a sustained coverage stall escalates the term by one point per 3 extra steps', () => {
  const base = {
    currentHash: 'hash-A',
    previousCombined: 'hash-Z',
    recentStructures: [] as string[],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: true,
  };
  assert.equal(computeStagnation({ ...base, coverageStallSteps: 2 }).stagnationScore, 1); // <3 → no extra
  assert.equal(computeStagnation({ ...base, coverageStallSteps: 3 }).stagnationScore, 2); // +1
  assert.equal(computeStagnation({ ...base, coverageStallSteps: 6 }).stagnationScore, 3); // +2
});

check('the escalated coverage term is bounded by the cap so the escape window always recovers', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-Z',
    recentStructures: [],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: true,
    coverageStallSteps: 999, // deep stall — extra points capped at COVERAGE_STALL_CAP (3)
  });
  assert.equal(result.stagnationScore, 1 + 3); // baseline 1 + capped 3
});

check('coverageStallSteps is ignored when coverage is NOT stalled', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-Z',
    recentStructures: [],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: false,
    coverageStallSteps: 100,
  });
  assert.equal(result.stagnationScore, 0);
});

check('all three signals combine additively', () => {
  const result = computeStagnation({
    currentHash: 'hash-A',
    previousCombined: 'hash-A',
    recentStructures: ['shell-1'],
    structure: 'shell-1',
    structureWindow: 8,
    coverageStagnant: true,
  });
  // combinedRepeated (2) + structureFamiliarity (1) + coverageStagnation (1) = 4
  assert.equal(result.stagnationScore, 4);
});

check('recentStructures window evicts the oldest entry once over capacity', () => {
  const result = computeStagnation({
    currentHash: 'hash-C',
    previousCombined: 'hash-B',
    recentStructures: ['shell-1', 'shell-2'],
    structure: 'shell-3',
    structureWindow: 2,
    coverageStagnant: false,
  });
  assert.deepEqual(result.nextRecentStructures, ['shell-2', 'shell-3']);
});

check('recentStructures window not yet full grows without eviction', () => {
  const result = computeStagnation({
    currentHash: 'hash-C',
    previousCombined: 'hash-B',
    recentStructures: ['shell-1'],
    structure: 'shell-2',
    structureWindow: 8,
    coverageStagnant: false,
  });
  assert.deepEqual(result.nextRecentStructures, ['shell-1', 'shell-2']);
});

check('penalty intensity scales linearly and clamps at 1', () => {
  assert.equal(computePenaltyIntensity(2, 3), Math.min(1, 1 / 3));
  assert.equal(computePenaltyIntensity(4, 3), 1); // (4-1)/3 = 1, exactly at clamp
  assert.equal(computePenaltyIntensity(10, 3), 1); // would exceed 1 without clamp
});

check('penalty window scales with stagnation score and caps at 6', () => {
  assert.equal(computePenaltyWindow(1), 2);
  assert.equal(computePenaltyWindow(5), 6);
  assert.equal(computePenaltyWindow(10), 6);
});

console.log(`\nstagnationScoring: ${passed} checks passed.`);

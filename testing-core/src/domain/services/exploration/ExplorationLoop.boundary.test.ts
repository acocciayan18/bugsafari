// Boundary Saturation vs Graph Exhaustion — the terminal completion classifier.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/ExplorationLoop.boundary.test.ts`.

import assert from 'node:assert/strict';
import { ExplorationLoop } from './ExplorationLoop.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { ExplorationLoopDeps } from './types.js';
import { ALL_TESTING_TYPE_IDS } from '../../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('ExplorationLoop — completion classification');

const actions: string[] = [];
function makeLoop(
  strictUrlLock: boolean,
  gate: ScenarioGate,
  cap = { reached: false, evictions: 0, maxNodes: 500 },
): ExplorationLoop {
  return new ExplorationLoop({
    strictUrlLock,
    gate,
    pathNavigator: { graphCapStatus: () => cap },
    telemetry: {
      emitMilestone: () => {},
      emit: (_type: string, meta: { actionExecuted?: string }) => { actions.push(meta.actionExecuted ?? ''); },
    },
  } as unknown as ExplorationLoopDeps);
}

// Unconstrained run (no lock, full profile) → genuine graph exhaustion.
const full = makeLoop(false, new ScenarioGate([...ALL_TESTING_TYPE_IDS]));
const fullResult = (full as unknown as { completionResult(): { reason: string; outcome: string } }).completionResult();
check('full-spectrum unlocked run reports Graph Exhausted', () => {
  assert.match(fullResult.reason, /Graph Exhausted/);
  assert.equal(fullResult.outcome, 'completed');
  assert.equal(actions.at(-1), 'graph-exhausted');
});

// Strict URL lock → the app graph beyond the launch URL was never reachable.
const locked = makeLoop(true, new ScenarioGate([...ALL_TESTING_TYPE_IDS]));
const lockedResult = (locked as unknown as { completionResult(): { reason: string; outcome: string } }).completionResult();
check('strict URL lock reports Boundary Saturation', () => {
  assert.match(lockedResult.reason, /Boundary Saturation Reached/);
  assert.match(lockedResult.reason, /strict URL lock/);
  assert.equal(lockedResult.outcome, 'boundary-saturated');
  assert.equal(actions.at(-1), 'boundary-saturation');
});

// Partial infiltration profile → states behind withheld interaction classes unexplored.
const partial = makeLoop(false, new ScenarioGate(['dataFuzzing', 'formBypass']));
const partialResult = (partial as unknown as { completionResult(): { reason: string; outcome: string } }).completionResult();
check('partial infiltration profile reports Boundary Saturation', () => {
  assert.match(partialResult.reason, /Boundary Saturation Reached/);
  assert.match(partialResult.reason, /partial infiltration profile/);
  assert.equal(partialResult.outcome, 'boundary-saturated');
});

// Node-cap eviction → states were dropped and never re-explored, so a claim of
// full graph coverage would be false (audit P3-06).
const capped = makeLoop(false, new ScenarioGate([...ALL_TESTING_TYPE_IDS]), {
  reached: true,
  evictions: 37,
  maxNodes: 500,
});
const cappedResult = (capped as unknown as { completionResult(): { reason: string; outcome: string } }).completionResult();
check('a run that hit the node cap never claims Graph Exhausted', () => {
  assert.match(cappedResult.reason, /Boundary Saturation Reached/);
  assert.match(cappedResult.reason, /node cap reached/);
  assert.match(cappedResult.reason, /37 evicted/);
  assert.equal(cappedResult.outcome, 'boundary-saturated');
});

console.log(`\n${passed} checks passed.`);

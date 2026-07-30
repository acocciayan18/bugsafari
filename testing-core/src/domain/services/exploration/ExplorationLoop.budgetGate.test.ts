// Budget-gate coverage-stall guard — the frontier-livelock terminator. When every
// remaining unexplored control is unreachable (its only shell is saturated/pruned),
// coverage stops being gained, so the budget must stop extending and the run ends
// Graph Exhausted instead of livelocking to the timebox.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/ExplorationLoop.budgetGate.test.ts`.

import assert from 'node:assert/strict';
import { ExplorationLoop } from './ExplorationLoop.js';
import type { ExplorationLoopDeps } from './types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('ExplorationLoop — budget-gate coverage-stall guard');

interface RegistryStub {
  hasUnexplored: boolean;
  stepsSinceGain: number;
  unexploredCount?: number;
}

function makeLoop(reg: RegistryStub, timeboxHit = false): ExplorationLoop {
  return new ExplorationLoop({
    checkTimebox: () => timeboxHit,
    clusterRegistry: {
      hasUnexploredControls: () => reg.hasUnexplored,
      stepsSinceCoverageGain: () => reg.stepsSinceGain,
      unexploredControlCount: () => reg.unexploredCount ?? 0,
    },
    telemetry: { emitMilestone: () => {}, emit: () => {} },
  } as unknown as ExplorationLoopDeps);
}

// Minimal RunContext slice the gate reads/mutates.
function ctx(over: Partial<Record<string, number>> = {}) {
  return {
    budget: 60,
    hardCap: 200,
    extensionSteps: 30,
    budgetExtensions: 0,
    coverageStallWindow: 12,
    ...over,
  } as unknown as Parameters<ExplorationLoop['checkBudgetGate' & keyof ExplorationLoop]>[1];
}

const gate = (loop: ExplorationLoop, step: number, c: unknown) =>
  (loop as unknown as { checkBudgetGate(s: number, c: unknown): 'proceed' | 'break' }).checkBudgetGate(step, c);

check('within budget always proceeds', () => {
  const c = ctx();
  const r = gate(makeLoop({ hasUnexplored: true, stepsSinceGain: 999 }), 10, c);
  assert.equal(r, 'proceed');
  assert.equal((c as { budget: number }).budget, 60); // untouched
});

check('over budget with fresh coverage extends and proceeds', () => {
  const c = ctx();
  const r = gate(makeLoop({ hasUnexplored: true, stepsSinceGain: 3, unexploredCount: 42 }), 61, c);
  assert.equal(r, 'proceed');
  assert.equal((c as { budget: number }).budget, 90); // 60 + 30
  assert.equal((c as { budgetExtensions: number }).budgetExtensions, 1);
});

check('over budget with STALLED coverage breaks — no livelock extension', () => {
  const c = ctx();
  const r = gate(makeLoop({ hasUnexplored: true, stepsSinceGain: 12, unexploredCount: 1946 }), 61, c);
  assert.equal(r, 'break');
  assert.equal((c as { budget: number }).budget, 60); // not extended despite 1946 "unexplored"
  assert.equal((c as { budgetExtensions: number }).budgetExtensions, 0);
});

check('over budget with no unexplored controls breaks', () => {
  const c = ctx();
  const r = gate(makeLoop({ hasUnexplored: false, stepsSinceGain: 0 }), 61, c);
  assert.equal(r, 'break');
});

check('over budget but timebox hit breaks even with fresh coverage', () => {
  const c = ctx();
  const r = gate(makeLoop({ hasUnexplored: true, stepsSinceGain: 1 }, true), 61, c);
  assert.equal(r, 'break');
});

check('over budget at hard cap breaks', () => {
  const c = ctx({ budget: 200, hardCap: 200 });
  const r = gate(makeLoop({ hasUnexplored: true, stepsSinceGain: 1 }), 201, c);
  assert.equal(r, 'break');
});

console.log(`\n${passed} checks passed.`);

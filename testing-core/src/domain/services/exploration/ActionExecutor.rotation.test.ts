// Deterministic tests for ActionExecutor's per-selector stress-scenario rotation.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/ActionExecutor.rotation.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { ActionExecutor } from './ActionExecutor.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ActionExecutorDeps } from './types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// pickStressScenario only reads deps.gate; the rest is stubbed.
function makeExecutor(gate: ScenarioGate): ActionExecutor {
  return new ActionExecutor({ gate } as unknown as ActionExecutorDeps);
}

function buttonLike(selector: string): InteractiveElement {
  return {
    tagName: 'button',
    id: '',
    className: '',
    innerText: 'Do it',
    selector,
    type: 'button',
  } as unknown as InteractiveElement;
}

// Private-method access for the rotation under test.
function pick(exec: ActionExecutor, el: InteractiveElement): string | null {
  const scenario = (exec as unknown as {
    pickStressScenario(t: InteractiveElement): { name: string } | null;
  }).pickStressScenario(el);
  return scenario?.name ?? null;
}

console.log('ActionExecutor — per-selector stress-scenario rotation');

check('first pick is index 0 (backward compatible) and rotation cycles', () => {
  const exec = makeExecutor(new ScenarioGate()); // empty selection → all enabled
  const el = buttonLike('#a');
  const first = pick(exec, el);
  assert.ok(first, 'expected a scenario on first pick');

  // Collect one full cycle then confirm it repeats with a fixed period.
  const seq: string[] = [first!];
  for (let i = 0; i < 11; i += 1) seq.push(pick(exec, el)!);

  const period = seq.indexOf(first!, 1);
  assert.ok(period > 1, 'rotation should advance to other scenarios, not re-fire the first');
  for (let i = 0; i < seq.length - period; i += 1) {
    assert.equal(seq[i], seq[i + period], 'sequence must repeat with a stable period');
  }
  // More than one distinct scenario actually fires on the same control.
  assert.ok(new Set(seq).size >= 2, 'a re-selected control must exercise multiple attacks');
});

check('distinct selectors rotate independently', () => {
  const exec = makeExecutor(new ScenarioGate());
  const a = pick(exec, buttonLike('#a'));
  const b = pick(exec, buttonLike('#b'));
  assert.equal(a, b, 'each selector starts its own cursor at index 0 → same first scenario');
});

check('returns null when every applicable scenario is gated off', () => {
  // navigation-only selection disables the stress/fuzz/security scenario families.
  const exec = makeExecutor(new ScenarioGate(['navigation']));
  const result = pick(exec, buttonLike('#a'));
  assert.equal(result, null, 'no enabled candidate → null');
});

console.log(`\nAll ${passed} checks passed.`);

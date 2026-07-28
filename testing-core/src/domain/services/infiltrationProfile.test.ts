// Deterministic contract test for the Infiltration Matrix. No unit runner is
// configured in this package, so this is a self-executing script:
// `npx tsx src/domain/services/infiltrationProfile.test.ts`.
// Exits non-zero on the first failed assertion.
//
// Pins the seams an audit removed dead weight from: the retired 'exploratory'
// testing type, the retired CUSTOM_STRATEGY_PROFILE, the profile ⇄ testing-type
// round trip that lets a session record which profile actually ran, and the
// finder registry's exclusion of a detector that can never fire.

import assert from 'node:assert/strict';
import { ScenarioGate } from './scenarioGate.js';
import { BUG_FINDERS } from '../../bugs/finders/index.js';
import { structuralProbeFinder } from '../../bugs/finders/structuralProbe.js';
import {
  ALL_TESTING_TYPE_IDS,
  INFILTRATION_PROFILE_CATALOG,
  TESTING_TYPE_CATALOG,
  DEFAULT_INFILTRATION_PROFILE,
  resolveInfiltrationProfile,
  resolveProfileFromTestingTypes,
  type TestingTypeId,
} from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Infiltration Matrix — profile contract + gate wiring');

// ── The vestigial 'exploratory' category is gone ─────────────────────────────
check("'exploratory' is no longer a selectable testing type", () => {
  assert.equal(ALL_TESTING_TYPE_IDS.includes('exploratory' as TestingTypeId), false);
  assert.equal(TESTING_TYPE_CATALOG.some((option) => option.id === ('exploratory' as TestingTypeId)), false);
});

check('every remaining testing type gates at least one scenario', () => {
  // A category with an empty scenario list can never change a run's behaviour —
  // that is exactly what made 'exploratory' dead weight.
  for (const option of TESTING_TYPE_CATALOG) {
    assert.ok(option.scenarios.length > 0, `${option.id} gates no scenarios`);
  }
});

// ── Profile resolution ───────────────────────────────────────────────────────
check('the full-spectrum profile enables every testing type', () => {
  const resolved = resolveInfiltrationProfile({ profile: 'CHAOS_INFILTRATION' });
  assert.deepEqual([...resolved].sort(), [...ALL_TESTING_TYPE_IDS].sort());
});

check('each profile resolves to its declared testing types', () => {
  for (const option of INFILTRATION_PROFILE_CATALOG) {
    assert.deepEqual(resolveInfiltrationProfile({ profile: option.id }), option.testingTypes);
  }
});

check('a retired/unknown profile id falls back to all-on rather than an empty gate', () => {
  // Back-compat: an older client may still send CUSTOM_STRATEGY_PROFILE.
  const resolved = resolveInfiltrationProfile({ profile: 'CUSTOM_STRATEGY_PROFILE' as never });
  assert.deepEqual([...resolved].sort(), [...ALL_TESTING_TYPE_IDS].sort());
  assert.deepEqual([...resolveInfiltrationProfile(undefined)].sort(), [...ALL_TESTING_TYPE_IDS].sort());
});

check('the default profile exists in the catalog', () => {
  assert.ok(INFILTRATION_PROFILE_CATALOG.some((option) => option.id === DEFAULT_INFILTRATION_PROFILE));
});

// ── Reverse resolution: what a session records about the run ─────────────────
check('every profile round-trips through its resolved testing types', () => {
  for (const option of INFILTRATION_PROFILE_CATALOG) {
    const resolved = resolveInfiltrationProfile({ profile: option.id });
    assert.equal(resolveProfileFromTestingTypes(resolved), option.id);
  }
});

check('reverse resolution is order-independent', () => {
  const reversed = [...resolveInfiltrationProfile({ profile: 'HIGH_FREQUENCY_CONCURRENCY_STRAIN' })].reverse();
  assert.equal(resolveProfileFromTestingTypes(reversed), 'HIGH_FREQUENCY_CONCURRENCY_STRAIN');
});

check('an ad-hoc selection matching no profile resolves to undefined', () => {
  assert.equal(resolveProfileFromTestingTypes(['dataFuzzing']), undefined);
  assert.equal(resolveProfileFromTestingTypes([]), undefined);
});

check('no two profiles share a testing-type set (reverse resolution stays exact)', () => {
  const keys = INFILTRATION_PROFILE_CATALOG.map((option) => [...option.testingTypes].sort().join('|'));
  assert.equal(new Set(keys).size, keys.length);
});

// ── Gate behaviour per profile ───────────────────────────────────────────────
check('a single-type profile enables only its own scenarios', () => {
  const gate = new ScenarioGate(resolveInfiltrationProfile({ profile: 'AUTH_STATE_SUBVERSION' }));
  assert.equal(gate.isScenarioEnabled('StorageTamper'), true);
  assert.equal(gate.isScenarioEnabled('DataFuzzer'), false);
  assert.equal(gate.isScenarioEnabled('NetworkSaboteur'), false);
  assert.equal(gate.isScenarioEnabled('ButtonSpammer'), false);
});

check('the concurrency-strain profile enables both concurrency and network sabotage', () => {
  const gate = new ScenarioGate(resolveInfiltrationProfile({ profile: 'HIGH_FREQUENCY_CONCURRENCY_STRAIN' }));
  assert.equal(gate.isScenarioEnabled('ButtonSpammer'), true);
  assert.equal(gate.isScenarioEnabled('CoordinateBombing'), true);
  assert.equal(gate.isScenarioEnabled('NetworkSaboteur'), true);
  assert.equal(gate.isScenarioEnabled('StorageTamper'), false);
});

check('an empty selection enables everything (backward compatible)', () => {
  const gate = new ScenarioGate([]);
  assert.deepEqual([...gate.activeCategories()].sort(), [...ALL_TESTING_TYPE_IDS].sort());
});

// ── Finder registry ──────────────────────────────────────────────────────────
check('the route-mutation finder is not registered while RouteTrasher is disabled', () => {
  // It self-gates on an active ROUTE_TRASH transaction that nothing opens, so
  // registering it advertised a bug class the run could never detect.
  assert.equal(BUG_FINDERS.includes(structuralProbeFinder), false);
});

check('every registered finder gates on a live testing type', () => {
  for (const finder of BUG_FINDERS) {
    if (!finder.testingType) continue;
    assert.ok(
      ALL_TESTING_TYPE_IDS.includes(finder.testingType),
      `${finder.bugClass} gates on retired testing type ${finder.testingType}`,
    );
  }
});

console.log(`\nInfiltration Matrix: ${passed} checks passed.`);

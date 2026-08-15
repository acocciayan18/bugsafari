// Deterministic wiring test for the AsyncStateRacer scenario. No unit runner is
// configured in this package, so this is a self-executing script:
// `npx tsx src/domain/scenarios/asyncStateRacer.test.ts`.
// Exits non-zero on the first failed assertion.
//
// Runtime behaviour (the interruption race itself) is Playwright-driven and is
// verified by the live harness; this pins the pure integration seams: gate,
// testing-type catalog, infiltration profile, fault attribution, and registry
// membership — so the scenario can never be silently unwired.

import assert from 'node:assert/strict';
import { asyncStateRacer } from './asyncStateRacer.js';
import { stressScenarioMap } from './index.js';
import { ScenarioGate } from '../services/scenarioGate.js';
import {
  resolveScenarioAttribution,
  SCENARIO_CATALOG,
} from '../../bugs/knowledgeBase/scenarioCatalog.js';
import { classifyFault } from '../../bugs/knowledgeBase/FaultClassifier.js';
import {
  TESTING_TYPE_CATALOG,
  INFILTRATION_PROFILE_CATALOG,
  ALL_TESTING_TYPE_IDS,
  resolveInfiltrationProfile,
} from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('AsyncStateRacer — pipeline wiring (gate / catalog / profile / attribution / registry)');

check('scenario exposes the stable name AsyncStateRacer', () => {
  assert.equal(asyncStateRacer.name, 'AsyncStateRacer');
});

check('testing-type catalog gains an asyncRace category owning AsyncStateRacer', () => {
  const option = TESTING_TYPE_CATALOG.find((o) => o.id === 'asyncRace');
  assert.ok(option, 'asyncRace category missing from TESTING_TYPE_CATALOG');
  assert.ok(option!.scenarios.includes('AsyncStateRacer'));
  assert.ok(ALL_TESTING_TYPE_IDS.includes('asyncRace'));
});

check('gate resolves AsyncStateRacer to the asyncRace category', () => {
  const only = new ScenarioGate(['asyncRace']);
  assert.equal(only.isEnabled('asyncRace'), true);
  assert.equal(only.isScenarioEnabled('AsyncStateRacer'), true);
  // Isolated: an asyncRace-only run must NOT enable other scenarios' categories.
  assert.equal(only.isScenarioEnabled('DataFuzzer'), false);
  assert.equal(only.isScenarioEnabled('ButtonSpammer'), false);
});

check('gate leaves AsyncStateRacer disabled when asyncRace is not selected', () => {
  const gate = new ScenarioGate(['dataFuzzing']);
  assert.equal(gate.isEnabled('asyncRace'), false);
  assert.equal(gate.isScenarioEnabled('AsyncStateRacer'), false);
});

check('classifier attributes AsyncStateRacer faults to the asyncRace testing type', () => {
  assert.ok(SCENARIO_CATALOG.AsyncStateRacer, 'AsyncStateRacer missing from SCENARIO_CATALOG');
  const attribution = resolveScenarioAttribution('AsyncStateRacer');
  assert.equal(attribution.scenario, 'AsyncStateRacer');
  assert.equal(attribution.testingType, 'asyncRace');
});

check('a client crash during the race classifies as RUNTIME_STABILITY_EXCEPTION / asyncRace', () => {
  const c = classifyFault({
    faultType: 'EXCEPTION',
    message: 'Uncaught TypeError: Cannot read properties of undefined (reading "setState")',
    scenario: 'AsyncStateRacer',
  });
  assert.equal(c.bugClass, 'RUNTIME_STABILITY_EXCEPTION');
  assert.equal(c.testingType, 'asyncRace');
  // FaultClassifier assigns the bug-catalog default (MEDIUM); the Critical live tier
  // is StabilityMonitor's separate severity layer.
  assert.equal(c.severity, 'MEDIUM');
});

check('a 5xx from an interrupted request classifies as SERVER_API_FAILURE / asyncRace', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: '500 Internal Server Error',
    statusCode: 500,
    scenario: 'AsyncStateRacer',
  });
  assert.equal(c.bugClass, 'SERVER_API_FAILURE');
  assert.equal(c.testingType, 'asyncRace');
  assert.equal(c.severity, 'HIGH');
});

check('dedicated ASYNC_LIFECYCLE_ASSAULT profile resolves to exactly [asyncRace]', () => {
  const option = INFILTRATION_PROFILE_CATALOG.find((p) => p.id === 'ASYNC_LIFECYCLE_ASSAULT');
  assert.ok(option, 'ASYNC_LIFECYCLE_ASSAULT profile missing');
  assert.deepEqual(resolveInfiltrationProfile({ profile: 'ASYNC_LIFECYCLE_ASSAULT' }), ['asyncRace']);
});

check('full-spectrum CHAOS_INFILTRATION profile now includes asyncRace', () => {
  assert.ok(resolveInfiltrationProfile({ profile: 'CHAOS_INFILTRATION' }).includes('asyncRace'));
});

check('the by-name scenario map exposes AsyncStateRacer', () => {
  assert.equal(stressScenarioMap.AsyncStateRacer?.name, 'AsyncStateRacer');
});

console.log(`\nAsyncStateRacer wiring: ${passed} checks passed.`);

// Deterministic wiring + oracle test for the StorageTamper scenario. No unit runner
// is configured in this package, so this is a self-executing script:
// `npx tsx src/domain/scenarios/storageTamper.test.ts`.
// Exits non-zero on the first failed assertion.
//
// The browser-side tamper (storage/JWT mutation + reload) is Playwright-driven and
// verified by the live harness; this pins the PURE seams: the privileged-surface
// oracle, auth-key matcher, gate, testing-type catalog, infiltration profile, fault
// attribution, and registry membership — so the scenario can never be silently unwired.

import assert from 'node:assert/strict';
import {
  storageTamper,
  decideStorageVerdict,
  matchesAuthKey,
} from './storageTamper.js';
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

console.log('StorageTamper — oracle + pipeline wiring (gate / catalog / profile / attribution / registry)');

// ── Pure oracle: only a strict positive delta is a finding ────────────────────
check('oracle GAINED only when privileged surface rises from below', () => {
  assert.equal(decideStorageVerdict({ before: 0, after: 2 }), 'GAINED');
  assert.equal(decideStorageVerdict({ before: 1, after: 3 }), 'GAINED');
});

check('oracle NONE when the surface was already visible (no delta)', () => {
  // Genuinely-authenticated session: markers present before AND after → not a finding.
  assert.equal(decideStorageVerdict({ before: 3, after: 3 }), 'NONE');
  assert.equal(decideStorageVerdict({ before: 4, after: 2 }), 'NONE');
});

check('oracle ABSENT when no privileged surface exists at all', () => {
  assert.equal(decideStorageVerdict({ before: 0, after: 0 }), 'ABSENT');
});

check('auth-key matcher accepts identity/privilege keys and rejects benign ones', () => {
  for (const key of ['role', 'isAdmin', 'is_admin', 'authToken', 'jwt', 'user_session', 'access_token', 'scopes', 'isLoggedIn']) {
    assert.equal(matchesAuthKey(key), true, `expected auth key: ${key}`);
  }
  for (const key of ['theme', 'cartItems', 'locale', 'lastRoute', 'fontSize']) {
    assert.equal(matchesAuthKey(key), false, `expected benign key: ${key}`);
  }
});

// ── Pipeline wiring ───────────────────────────────────────────────────────────
check('scenario exposes the stable name StorageTamper', () => {
  assert.equal(storageTamper.name, 'StorageTamper');
});

check('testing-type catalog gains an authState category owning StorageTamper', () => {
  const option = TESTING_TYPE_CATALOG.find((o) => o.id === 'authState');
  assert.ok(option, 'authState category missing from TESTING_TYPE_CATALOG');
  assert.ok(option!.scenarios.includes('StorageTamper'));
  assert.ok(ALL_TESTING_TYPE_IDS.includes('authState'));
});

check('gate resolves StorageTamper to the authState category, isolated from others', () => {
  const only = new ScenarioGate(['authState']);
  assert.equal(only.isEnabled('authState'), true);
  assert.equal(only.isScenarioEnabled('StorageTamper'), true);
  assert.equal(only.isScenarioEnabled('DataFuzzer'), false);
  assert.equal(only.isScenarioEnabled('AsyncStateRacer'), false);
});

check('gate leaves StorageTamper disabled when authState is not selected', () => {
  const gate = new ScenarioGate(['dataFuzzing']);
  assert.equal(gate.isEnabled('authState'), false);
  assert.equal(gate.isScenarioEnabled('StorageTamper'), false);
});

check('classifier attributes StorageTamper faults to the authState testing type', () => {
  assert.ok(SCENARIO_CATALOG.StorageTamper, 'StorageTamper missing from SCENARIO_CATALOG');
  const attribution = resolveScenarioAttribution('StorageTamper');
  assert.equal(attribution.scenario, 'StorageTamper');
  assert.equal(attribution.testingType, 'authState');
});

check('a confirmed StorageTamper oracle hit classifies as CLIENT_TRUST_BOUNDARY_VIOLATION (CRITICAL)', () => {
  const c = classifyFault({
    faultType: 'CONSOLE',
    message: 'Client granted privileged UI from forged storage',
    scenario: 'StorageTamper',
    confirmed: true,
  });
  assert.equal(c.bugClass, 'CLIENT_TRUST_BOUNDARY_VIOLATION');
  assert.equal(c.testingType, 'authState');
  assert.equal(c.cwe, 'CWE-602');
  assert.equal(c.severity, 'CRITICAL');
  assert.equal(c.confidence, 'CONFIRMED');
});

check('an UNCONFIRMED StorageTamper fault is NEVER promoted to the security class (no false positive)', () => {
  const c = classifyFault({
    faultType: 'CONSOLE',
    message: 'benign console noise while authState active',
    scenario: 'StorageTamper',
    // confirmed omitted → security verdict must not be inferred from scenario alone
  });
  assert.notEqual(c.bugClass, 'CLIENT_TRUST_BOUNDARY_VIOLATION');
  assert.notEqual(c.confidence, 'CONFIRMED');
});

check('dedicated AUTH_STATE_SUBVERSION profile resolves to exactly [authState]', () => {
  const option = INFILTRATION_PROFILE_CATALOG.find((p) => p.id === 'AUTH_STATE_SUBVERSION');
  assert.ok(option, 'AUTH_STATE_SUBVERSION profile missing');
  assert.deepEqual(resolveInfiltrationProfile({ profile: 'AUTH_STATE_SUBVERSION' }), ['authState']);
});

check('full-spectrum CHAOS_INFILTRATION profile now includes authState', () => {
  assert.ok(resolveInfiltrationProfile({ profile: 'CHAOS_INFILTRATION' }).includes('authState'));
});

check('the by-name scenario map exposes StorageTamper', () => {
  assert.equal(stressScenarioMap.StorageTamper?.name, 'StorageTamper');
});

console.log(`\nStorageTamper wiring: ${passed} checks passed.`);

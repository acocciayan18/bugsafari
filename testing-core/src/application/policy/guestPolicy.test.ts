// Self-executing checks for the guest launch policy. No test framework (per the
// "no external libraries" rule) — discovered by scripts/run-tests.mjs via tsx.

import assert from 'node:assert/strict';
import { applyGuestLaunchPolicy, GUEST_ALLOWED_TESTING_TYPES, GUEST_MAX_TIMEBOX_MS } from './guestPolicy.js';
import { clampTimebox, MAX_TIMEBOX_MS, type OptimizationSettings, type TestingTypeId } from '../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('creates a concrete settings object when none is supplied', () => {
  const { settings } = applyGuestLaunchPolicy(undefined, ['dataFuzzing']);
  assert.equal(settings.subtreeLock, true);
  assert.equal(settings['form-fuzz-cap'], 1);
  assert.equal(settings['dialog-read-only'], true);
  assert.equal(settings['transition-repeat-budget'], 2);
});

check('forces guest scope overrides over client-supplied values', () => {
  const client: OptimizationSettings = {
    'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true,
    subtreeLock: false, 'page-saturation-visits': 99, 'page-saturation-interactions': 99, 'form-fuzz-cap': 20,
  };
  const { settings } = applyGuestLaunchPolicy(client, ['dataFuzzing']);
  assert.equal(settings.subtreeLock, true);
  assert.equal(settings['page-saturation-visits'], 4);
  assert.equal(settings['page-saturation-interactions'], 12);
  assert.equal(settings['form-fuzz-cap'], 1);
});

check('trims heavy scenario categories (concurrency, navigation)', () => {
  const requested: TestingTypeId[] = ['dataFuzzing', 'concurrency', 'navigation', 'authState'];
  const { selectedScenarios } = applyGuestLaunchPolicy(undefined, requested);
  assert.deepEqual(selectedScenarios, ['dataFuzzing', 'authState']);
  assert.ok(!selectedScenarios.includes('concurrency'));
  assert.ok(!selectedScenarios.includes('navigation'));
});

check('falls back to the full guest-allowed set when nothing survives the trim', () => {
  const { selectedScenarios } = applyGuestLaunchPolicy(undefined, ['concurrency', 'navigation']);
  assert.deepEqual(selectedScenarios, [...GUEST_ALLOWED_TESTING_TYPES]);
});

check('policy + guest clamp caps a 30-minute request to 5 minutes', () => {
  const client: OptimizationSettings = {
    'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true,
    'execution-timebox-ms': MAX_TIMEBOX_MS,
  };
  const { settings } = applyGuestLaunchPolicy(client, ['dataFuzzing']);
  clampTimebox(settings, GUEST_MAX_TIMEBOX_MS);
  assert.equal(settings['execution-timebox-ms'], GUEST_MAX_TIMEBOX_MS);
});

console.log(`guestPolicy.test.ts: ${passed} checks passed`);

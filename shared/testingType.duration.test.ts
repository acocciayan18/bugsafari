// Self-executing checks for the execution time-limit presets + the shared timebox
// clamp. No test framework (per the "no external libraries" rule) — discovered by
// shared/scripts/run-tests.mjs.

import assert from 'node:assert/strict';
import {
  TEST_DURATION_PRESETS,
  DEFAULT_TEST_DURATION_ID,
  durationIdToFlags,
  durationIdFromFlags,
  clampTimebox,
  MIN_TIMEBOX_MS,
  MAX_TIMEBOX_MS,
  GUEST_MAX_TIMEBOX_MS,
  type OptimizationSettings,
} from './types.js';

const baseSettings = (): OptimizationSettings => ({ 'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true });

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('each preset maps to the correct timebox ms', () => {
  assert.equal(durationIdToFlags('5m')['execution-timebox-ms'], 300_000);
  assert.equal(durationIdToFlags('10m')['execution-timebox-ms'], 600_000);
  assert.equal(durationIdToFlags('20m')['execution-timebox-ms'], 1_200_000);
  assert.equal(durationIdToFlags('30m')['execution-timebox-ms'], 1_800_000);
});

check('default preset is 10 minutes', () => {
  assert.equal(DEFAULT_TEST_DURATION_ID, '10m');
  assert.equal(durationIdToFlags(DEFAULT_TEST_DURATION_ID)['execution-timebox-ms'], 600_000);
});

check('every preset sits within the enforced clamp bounds', () => {
  for (const preset of TEST_DURATION_PRESETS) {
    const ms = preset.minutes * 60_000;
    assert.ok(ms >= MIN_TIMEBOX_MS && ms <= MAX_TIMEBOX_MS, `${preset.id} within bounds`);
  }
});

check('durationIdFromFlags is the inverse of durationIdToFlags', () => {
  for (const preset of TEST_DURATION_PRESETS) {
    assert.equal(durationIdFromFlags(durationIdToFlags(preset.id)), preset.id);
  }
});

check('durationIdFromFlags snaps to the nearest preset and falls back to default', () => {
  assert.equal(durationIdFromFlags({ 'execution-timebox-ms': 610_000 }), '10m'); // ~10m
  assert.equal(durationIdFromFlags({ 'execution-timebox-ms': 1_500_000 }), '20m'); // between 20 and 30, closer to 20 (300k vs 300k → first wins = 20m)
  assert.equal(durationIdFromFlags(undefined), DEFAULT_TEST_DURATION_ID);
  assert.equal(durationIdFromFlags({}), DEFAULT_TEST_DURATION_ID);
});

check('clampTimebox pins below MIN up to MIN', () => {
  const s: OptimizationSettings = { 'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true, 'execution-timebox-ms': 1_000 };
  clampTimebox(s);
  assert.equal(s['execution-timebox-ms'], MIN_TIMEBOX_MS);
});

check('clampTimebox pins above MAX down to MAX', () => {
  const s: OptimizationSettings = { 'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true, 'execution-timebox-ms': 5_000_000 };
  clampTimebox(s);
  assert.equal(s['execution-timebox-ms'], MAX_TIMEBOX_MS);
});

check('clampTimebox leaves every preset untouched', () => {
  for (const preset of TEST_DURATION_PRESETS) {
    const ms = preset.minutes * 60_000;
    const s: OptimizationSettings = { 'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true, 'execution-timebox-ms': ms };
    clampTimebox(s);
    assert.equal(s['execution-timebox-ms'], ms, `${preset.id} unchanged`);
  }
});

check('clampTimebox strips a non-finite value and no-ops on undefined settings', () => {
  const s: OptimizationSettings = { 'adaptive-risk-scorer': true, 'state-aware-hashing': true, 'concurrent-spam-event': true, 'execution-timebox-ms': Number.NaN };
  clampTimebox(s);
  assert.equal(s['execution-timebox-ms'], undefined);
  clampTimebox(undefined); // must not throw
});

check('GUEST_MAX_TIMEBOX_MS is 5 minutes and within the hard bounds', () => {
  assert.equal(GUEST_MAX_TIMEBOX_MS, 300_000);
  assert.ok(GUEST_MAX_TIMEBOX_MS >= MIN_TIMEBOX_MS && GUEST_MAX_TIMEBOX_MS <= MAX_TIMEBOX_MS);
});

check('clampTimebox with the guest max caps a 30-minute request to 5 minutes', () => {
  const s = { ...baseSettings(), 'execution-timebox-ms': MAX_TIMEBOX_MS };
  clampTimebox(s, GUEST_MAX_TIMEBOX_MS);
  assert.equal(s['execution-timebox-ms'], GUEST_MAX_TIMEBOX_MS);
});

check('clampTimebox with the guest max still honors the MIN floor', () => {
  const s = { ...baseSettings(), 'execution-timebox-ms': 1_000 };
  clampTimebox(s, GUEST_MAX_TIMEBOX_MS);
  assert.equal(s['execution-timebox-ms'], MIN_TIMEBOX_MS);
});

check('clampTimebox leaves an under-guest-cap value untouched', () => {
  const s = { ...baseSettings(), 'execution-timebox-ms': 120_000 };
  clampTimebox(s, GUEST_MAX_TIMEBOX_MS);
  assert.equal(s['execution-timebox-ms'], 120_000);
});

console.log(`testingType.duration.test.ts: ${passed} checks passed`);

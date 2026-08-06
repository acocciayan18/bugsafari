// Deterministic checks for the process-wide degradation flag. No unit-test runner is
// configured, so run with
// `npx tsx src/infrastructure/monitoring/NetworkQuarantine.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { NetworkQuarantine } from './NetworkQuarantine.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('NetworkQuarantine — degraded-window flag');

check('starts clean', () => {
  NetworkQuarantine.reset();
  assert.equal(NetworkQuarantine.isDegraded(), false);
  assert.equal(NetworkQuarantine.degradedSince(), null);
});

check('begin is idempotent and records the reason', () => {
  NetworkQuarantine.reset();
  assert.equal(NetworkQuarantine.beginDegraded('probe down'), true);
  assert.equal(NetworkQuarantine.isDegraded(), true);
  assert.equal(NetworkQuarantine.currentReason(), 'probe down');
  assert.equal(NetworkQuarantine.beginDegraded('again'), false, 'no state change while already degraded');
  assert.equal(NetworkQuarantine.currentReason(), 'probe down', 'original reason preserved');
});

check('end clears the window and is idempotent', () => {
  NetworkQuarantine.reset();
  NetworkQuarantine.beginDegraded('x');
  assert.equal(NetworkQuarantine.endDegraded(), true);
  assert.equal(NetworkQuarantine.isDegraded(), false);
  assert.equal(NetworkQuarantine.endDegraded(), false, 'already healthy');
});

check('reset forces a clean slate', () => {
  NetworkQuarantine.beginDegraded('y');
  NetworkQuarantine.reset();
  assert.equal(NetworkQuarantine.isDegraded(), false);
  assert.equal(NetworkQuarantine.currentReason(), '');
});

console.log(`\n${passed} checks passed`);

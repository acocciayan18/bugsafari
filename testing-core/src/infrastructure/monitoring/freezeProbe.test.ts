// Standalone tests for the heartbeat freeze navigation guard (pure predicate, browser-free).
// Run with `npx tsx src/infrastructure/monitoring/freezeProbe.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { isNavigationProbeError } from './stabilityMonitor.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('freezeProbe — isNavigationProbeError');

const navErrors = [
  'Execution context was destroyed, most likely because of a navigation.',
  'Execution context is not available in detached frame',
  'Protocol error: Target closed. context is not available',
  'Navigation failed because page is navigating and changing the content',
  'Error: frame was detached',
];
for (const msg of navErrors) {
  check(`navigation error matches: ${msg.slice(0, 32)}…`, () => {
    assert.equal(isNavigationProbeError(new Error(msg)), true);
    assert.equal(isNavigationProbeError(msg), true);
  });
}

check('the withTimeout wedge signal is NOT a navigation error', () => {
  assert.equal(isNavigationProbeError(new Error('Operation timed out after 5000ms')), false);
});

check('a generic app error is NOT a navigation error', () => {
  assert.equal(isNavigationProbeError(new Error('Something unrelated broke')), false);
});

check('non-error inputs never throw and read as not-navigation', () => {
  assert.equal(isNavigationProbeError(undefined), false);
  assert.equal(isNavigationProbeError(null), false);
  assert.equal(isNavigationProbeError({}), false);
});

console.log(`\n${passed} passed`);

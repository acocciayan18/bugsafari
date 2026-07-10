// Standalone deterministic tests for the pure adaptive-pacing no-op early-exit
// predicate (audit D2/D3). Run via `npm test` or `npx tsx .../pacing.test.ts`.

import assert from 'node:assert/strict';
import { shouldExitNoOp } from './pacing.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('pacing — adaptive verifyTraversal no-op early-exit (D2/D3)');

const base = { minObserveMs: 600, quietMs: 350, noOpCeilingMs: 1800 };

check('does NOT bail before the observation floor even if idle', () => {
  assert.equal(
    shouldExitNoOp({ ...base, elapsedMs: 300, inFlightRequests: 0, msSinceLastActivity: 9999 }),
    false,
  );
});

check('bails on a quiet, idle, unchanged page past the floor', () => {
  assert.equal(
    shouldExitNoOp({ ...base, elapsedMs: 800, inFlightRequests: 0, msSinceLastActivity: 400 }),
    true,
  );
});

check('does NOT bail while a request is in flight below the ceiling (slow transition may be loading)', () => {
  assert.equal(
    shouldExitNoOp({ ...base, elapsedMs: 1200, inFlightRequests: 1, msSinceLastActivity: 400 }),
    false,
  );
});

check('does NOT bail when the network went quiet only very recently', () => {
  assert.equal(
    shouldExitNoOp({ ...base, elapsedMs: 1200, inFlightRequests: 0, msSinceLastActivity: 100 }),
    false,
  );
});

check('bails exactly at the quiet threshold', () => {
  assert.equal(
    shouldExitNoOp({ ...base, elapsedMs: 700, inFlightRequests: 0, msSinceLastActivity: 350 }),
    true,
  );
});

check('bails at the ceiling even on a perpetually chattering page (ad/analytics beacons)', () => {
  // Network never goes quiet (recent activity, request in flight) — the ceiling
  // still bounds the no-op cost instead of pinning at the hard cap.
  assert.equal(
    shouldExitNoOp({ ...base, elapsedMs: 1800, inFlightRequests: 2, msSinceLastActivity: 20 }),
    true,
  );
});

console.log(`\npacing: ${passed} checks passed.`);

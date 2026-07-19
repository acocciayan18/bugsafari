// Standalone deterministic test for the infinite-loading watchdog sweep schedule.
// Run with `npx tsx "src/domain/heuristics/hangSweep.test.ts"`; exits non-zero on
// the first failed assertion.

import assert from 'node:assert/strict';
import { initialSweepState, isSweepDue, advanceSweep, type SweepPolicy } from './hangSweep.js';

const POLICY: SweepPolicy = { thresholdMs: 8000, reSweepBaseMs: 10000, maxSweeps: 3 };

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Hang-sweep schedule — first probe, backoff re-probes, bounded budget');

check('no probe before the hang threshold', () => {
  const s = initialSweepState(1000, POLICY);
  assert.equal(isSweepDue(s, 1000 + 7999, POLICY), false);
});

check('first probe fires once the threshold is crossed', () => {
  const s = initialSweepState(1000, POLICY);
  assert.equal(isSweepDue(s, 1000 + 8000, POLICY), true);
});

check('a probed request is not re-probed on the very next tick', () => {
  const first = advanceSweep(initialSweepState(1000, POLICY), 9000, POLICY);
  assert.equal(first.sweeps, 1);
  assert.equal(isSweepDue(first, 10000, POLICY), false);
});

check('re-probe backoff widens with each attempt (10s, then 20s)', () => {
  const first = advanceSweep(initialSweepState(1000, POLICY), 9000, POLICY);
  assert.equal(first.nextSweepAtMs, 19000);
  assert.equal(isSweepDue(first, 19000, POLICY), true);

  const second = advanceSweep(first, 19000, POLICY);
  assert.equal(second.sweeps, 2);
  assert.equal(second.nextSweepAtMs, 39000);
  assert.equal(isSweepDue(second, 38999, POLICY), false);
});

check('a late-rendering spinner is still caught on a re-probe', () => {
  // The spinner appears at ~25s — after the 8s first probe, before the budget runs out.
  let s = initialSweepState(0, POLICY);
  const probeInstants: number[] = [];
  for (let now = 0; now <= 60000; now += 1000) {
    if (!isSweepDue(s, now, POLICY)) continue;
    probeInstants.push(now);
    s = advanceSweep(s, now, POLICY);
  }
  assert.deepEqual(probeInstants, [8000, 18000, 38000]);
  assert.ok(probeInstants.some((t) => t > 25000), 'at least one probe lands after the spinner renders');
});

check('probe budget is bounded — a long-poll costs at most maxSweeps probes', () => {
  let s = initialSweepState(0, POLICY);
  let probes = 0;
  for (let now = 0; now <= 10 * 60 * 1000; now += 1000) {
    if (!isSweepDue(s, now, POLICY)) continue;
    probes += 1;
    s = advanceSweep(s, now, POLICY);
  }
  assert.equal(probes, POLICY.maxSweeps);
  assert.equal(isSweepDue(s, Number.MAX_SAFE_INTEGER, POLICY), false);
});

console.log(`\nHang-sweep schedule: ${passed} checks passed.`);

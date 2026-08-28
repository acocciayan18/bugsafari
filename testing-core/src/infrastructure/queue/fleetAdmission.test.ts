// Guards the false-QUEUED regression: a session was placed in QUEUED immediately after
// creation and stayed there with nothing running, because /api/start-test enqueued every
// non-guest launch without ever asking whether a worker existed to claim it. An idle
// fleet must admit at once; a fleet of zero workers must refuse instead of queueing.
// Pure decision, no Redis. Self-executing: `npx tsx fleetAdmission.test.ts`.

import assert from 'node:assert/strict';
import { resolveFleetAdmission, type FleetAdmissionInput } from './fleetAdmission.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const input = (over: Partial<FleetAdmissionInput> = {}): FleetAdmissionInput =>
  ({ workerCount: 2, waiting: 0, maxQueueDepth: 50, ...over });

console.log('fleetAdmission — launch gate for the distributed path');

// THE regression. An idle fleet has no legitimate queue condition, so the launch must
// pass straight through to the enqueue and be claimed on the next worker poll.
check('an idle fleet admits immediately, never queues', () => {
  assert.deepStrictEqual(resolveFleetAdmission(input()), { ok: true });
  assert.deepStrictEqual(resolveFleetAdmission(input({ workerCount: 1 })), { ok: true });
});

check('a fleet of zero workers refuses instead of parking the run forever', () => {
  const verdict = resolveFleetAdmission(input({ workerCount: 0 }));
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.ok === false && verdict.code, 'FLEET_UNAVAILABLE');
  assert.strictEqual(verdict.ok === false && verdict.queueDepth, 0);
});

// Managed Redis tiers disable CLIENT LIST. Unknown capacity is not zero capacity —
// treating it as zero would refuse every launch on those deployments.
check('unknown fleet capacity degrades to allow, not to refuse', () => {
  assert.deepStrictEqual(resolveFleetAdmission(input({ workerCount: null })), { ok: true });
});

// A busy fleet is the one condition that legitimately produces QUEUED.
check('a busy fleet still queues rather than refusing', () => {
  assert.deepStrictEqual(resolveFleetAdmission(input({ workerCount: 1, waiting: 1 })), { ok: true });
  assert.deepStrictEqual(resolveFleetAdmission(input({ workerCount: 2, waiting: 49 })), { ok: true });
});

check('the backlog ceiling still rejects at depth', () => {
  const verdict = resolveFleetAdmission(input({ waiting: 50 }));
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.ok === false && verdict.code, 'QUEUE_FULL');
  assert.strictEqual(verdict.ok === false && verdict.queueDepth, 50);
});

// A saturated queue with no workers is an absent fleet first: reporting QUEUE_FULL
// would tell the operator to retry shortly for a fleet that is not coming back.
check('an absent fleet outranks a full queue', () => {
  const verdict = resolveFleetAdmission(input({ workerCount: 0, waiting: 80 }));
  assert.strictEqual(verdict.ok === false && verdict.code, 'FLEET_UNAVAILABLE');
});

console.log(`fleetAdmission.test.ts: ${passed} checks passed`);

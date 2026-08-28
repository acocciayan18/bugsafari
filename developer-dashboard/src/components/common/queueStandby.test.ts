// Guards the operator-facing half of the false-QUEUED regression. With no worker
// connected the chip still read "Queued, 1 of 1 waiting", which is indistinguishable from
// a real line, so an operator waited on a run that could never be claimed.
// Pure copy, no React. Self-executing: `npx tsx queueStandby.test.ts`.

import assert from 'node:assert/strict';
import { describeQueueStandby, type QueueStandbyInput } from './queueStandby.js';

let passed = 0;
function check(name: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

const input = (over: Partial<QueueStandbyInput> = {}): QueueStandbyInput =>
    ({ position: 1, depth: 1, activeCount: 0, workerCount: 1, ...over });

console.log('queueStandby — what the operator is told while queued');

check('a fleet of zero workers reads as a fault, not as a line', () => {
    const copy = describeQueueStandby(input({ workerCount: 0 }));
    assert.strictEqual(copy.place, 'no worker connected');
    assert.strictEqual(copy.fleet, null);
    assert.ok(!copy.place.includes('waiting'), 'must not imply a queue that is moving');
});

check('a real place in line is still reported', () => {
    assert.strictEqual(describeQueueStandby(input({ position: 2, depth: 3 })).place, '2 of 3 waiting');
});

check('fleet occupancy rides the chip once something is running', () => {
    assert.strictEqual(describeQueueStandby(input({ activeCount: 1, workerCount: 2 })).fleet, '1 of 2 running');
});

// Redis CLIENT LIST is disabled on some managed tiers: unknown capacity is not zero.
check('unknown capacity keeps the ordinary wording', () => {
    const copy = describeQueueStandby(input({ position: 1, depth: 1, activeCount: 1, workerCount: null }));
    assert.strictEqual(copy.place, '1 of 1 waiting');
    assert.strictEqual(copy.fleet, '1 running');
});

check('a position ahead of a lagging depth never renders backwards', () => {
    assert.strictEqual(describeQueueStandby(input({ position: 3, depth: 1 })).place, '3 of 3 waiting');
});

check('a job with no position yet says so', () => {
    assert.strictEqual(describeQueueStandby(input({ position: null })).place, 'awaiting worker');
});

console.log(`queueStandby.test.ts: ${passed} checks passed`);

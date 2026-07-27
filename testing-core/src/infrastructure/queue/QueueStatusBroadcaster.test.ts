// Queue-position contract covered without Redis: the pure projections the
// broadcaster and pushInitial both build their payloads from.
// Run: npx tsx src/infrastructure/queue/QueueStatusBroadcaster.test.ts

import assert from 'node:assert/strict';
import { mapSettledState, waitingUpdates } from './QueueStatusBroadcaster.js';
import { readMaxQueueDepth, type QueuePositions } from './TaskQueue.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('QueueStatusBroadcaster — position projection + fleet occupancy');

const positions = (over: Partial<QueuePositions> = {}): QueuePositions => ({
  order: ['j1', 'j2', 'j3'],
  queueDepth: 3,
  activeCount: 2,
  workerCount: 2,
  ...over,
});

check('every waiting job gets its own 1-based place in line', () => {
  const updates = waitingUpdates(positions());

  assert.deepEqual(updates.map((u) => [u.jobId, u.position]), [['j1', 1], ['j2', 2], ['j3', 3]]);
  assert.ok(updates.every((u) => u.state === 'waiting'), 'all waiting');
});

check('fleet occupancy rides every update, so a 2-worker fleet is visible while queued', () => {
  for (const update of waitingUpdates(positions())) {
    assert.equal(update.queueDepth, 3);
    assert.equal(update.activeCount, 2);
    assert.equal(update.workerCount, 2);
  }
});

check('unknown fleet capacity degrades to null instead of a wrong number', () => {
  // Redis CLIENT LIST is disabled on some managed tiers.
  const [first] = waitingUpdates(positions({ workerCount: null }));
  assert.equal(first?.workerCount, null);
  assert.equal(first?.activeCount, 2, 'activeCount is still authoritative');
});

check('an empty line emits nothing — the resync timer stays silent when idle', () => {
  assert.deepEqual(waitingUpdates(positions({ order: [], queueDepth: 0 })), []);
});

check('a settled job is never reported as active', () => {
  assert.equal(mapSettledState('active'), 'active');
  assert.equal(mapSettledState('failed'), 'failed');
  assert.equal(mapSettledState('completed'), 'completed');
  // A vanished job (removeOnComplete) must settle, not linger as running.
  assert.equal(mapSettledState('unknown'), 'completed');
});

console.log('\nTaskQueue — backlog ceiling');

const withEnv = (value: string | undefined, fn: () => void): void => {
  const previous = process.env.BUGSAFARI_MAX_QUEUE_DEPTH;
  if (value === undefined) delete process.env.BUGSAFARI_MAX_QUEUE_DEPTH;
  else process.env.BUGSAFARI_MAX_QUEUE_DEPTH = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.BUGSAFARI_MAX_QUEUE_DEPTH;
    else process.env.BUGSAFARI_MAX_QUEUE_DEPTH = previous;
  }
};

check('backlog ceiling defaults, and rejects values that would disable it', () => {
  withEnv(undefined, () => assert.equal(readMaxQueueDepth(), 50));
  withEnv('120', () => assert.equal(readMaxQueueDepth(), 120));
  // 0 / negative / garbage would make every launch a 503 or an unbounded queue.
  withEnv('0', () => assert.equal(readMaxQueueDepth(), 50));
  withEnv('-5', () => assert.equal(readMaxQueueDepth(), 50));
  withEnv('lots', () => assert.equal(readMaxQueueDepth(), 50));
});

console.log(`\n${passed} assertions passed.`);

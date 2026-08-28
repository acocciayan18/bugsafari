// Guards the ghost-backlog half of the false-QUEUED regression. Runs enqueued while no
// worker was connected stay in BullMQ's waiting list across API restarts; nothing drained
// it, so a fresh launch landed behind jobs no client could attach to, stop, or observe,
// and reported a queue position with nothing actually executing.
// Hand-rolled fakes, no Redis. Self-executing: `npx tsx registryReconciler.test.ts`.

import assert from 'node:assert/strict';
import { reconcileRunRegistry, type ReconcilerQueue, type ReconcilerRegistry } from './registryReconciler.js';
import type { RunRegistryEntry } from './RunRegistry.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const entry = (over: Partial<RunRegistryEntry> = {}): RunRegistryEntry => ({
  runToken: 'tok-1',
  runCode: 'RUN-0001',
  jobId: '1',
  userId: 'user-1',
  targetUrl: 'https://example.test',
  timeboxMs: 600_000,
  createdAt: new Date(0).toISOString(),
  ...over,
});

interface Fakes {
  registry: ReconcilerRegistry;
  queue: ReconcilerQueue;
  touched: string[];
  cleared: string[];
  removed: string[];
}

function fakes(options: {
  entries?: RunRegistryEntry[];
  states?: Record<string, string>;
  snapshots?: Record<string, unknown>;
  waiting?: { id: string; runToken: string }[];
  // Entries visible to the pre-removal re-read but NOT to the initial listing, i.e.
  // launches that registered while the reconciler was already walking.
  registeredLate?: RunRegistryEntry[];
}): Fakes {
  const touched: string[] = [];
  const cleared: string[] = [];
  const removed: string[] = [];
  const states = options.states ?? {};
  const snapshots = options.snapshots ?? {};
  const late = options.registeredLate ?? [];

  const registry: ReconcilerRegistry = {
    listEntries: async () => options.entries ?? [],
    findByRunToken: async (runToken) =>
      [...(options.entries ?? []), ...late].find((e) => e.runToken === runToken) ?? null,
    readSnapshot: async (runToken) => snapshots[runToken] ?? null,
    touch: async (runToken) => { touched.push(runToken); },
    clear: async (runToken) => { cleared.push(runToken); },
  };

  const queue: ReconcilerQueue = {
    getJobState: async (jobId) => states[jobId] ?? 'unknown',
    waitingJobRefs: async () => options.waiting ?? [],
    cancelQueuedJob: async (jobId) => {
      const state = states[jobId] ?? 'waiting';
      // Mirrors TaskQueue.cancelQueuedJob: BullMQ refuses to remove a locked job.
      if (state === 'active') return { removed: false, state };
      removed.push(jobId);
      return { removed: true, state };
    },
  };

  return { registry, queue, touched, cleared, removed };
}

async function run(): Promise<void> {
  console.log('registryReconciler — index/queue agreement in both directions');

  // THE regression. A waiting job nothing references still holds a place in the FIFO
  // line, so the next launch reports "1 of N waiting" with nothing running.
  await check('a waiting job with no registry entry is removed', async () => {
    const f = fakes({ entries: [], waiting: [{ id: '7', runToken: 'ghost-tok' }] });
    const result = await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.removed, ['7']);
    assert.strictEqual(result.removedGhostJobs, 1);
  });

  await check('a waiting job that IS referenced is kept and its entry refreshed', async () => {
    const f = fakes({
      entries: [entry({ jobId: '3', runToken: 'tok-3' })],
      states: { '3': 'waiting' },
      waiting: [{ id: '3', runToken: 'tok-3' }],
    });
    const result = await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.removed, [], 'a legitimate queued run must survive');
    assert.deepStrictEqual(f.touched, ['tok-3'], 'TTL refreshed so a long wait never looks like a ghost');
    assert.deepStrictEqual(f.cleared, []);
    assert.strictEqual(result.removedGhostJobs, 0);
  });

  // An enqueue still mid-flight in the API process has jobId 'pending', and its real job
  // may already be in the waiting list. Removing it would kill a launch in progress.
  await check('a job whose entry is still mid-enqueue is not swept', async () => {
    const f = fakes({
      entries: [entry({ jobId: 'pending', runToken: 'tok-new' })],
      waiting: [{ id: '9', runToken: 'tok-new' }],
    });
    await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.removed, []);
    assert.deepStrictEqual(f.cleared, [], "a 'pending' entry is left for the API to settle");
  });

  // The entry listing is sampled before the waiting listing, so a launch that registers
  // in between is absent from the snapshot. Removing it would destroy a live launch.
  await check('a launch that registered mid-pass is re-read, not destroyed', async () => {
    const f = fakes({
      entries: [],
      waiting: [{ id: '8', runToken: 'tok-late' }],
      registeredLate: [entry({ jobId: '8', runToken: 'tok-late' })],
    });
    const result = await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.removed, []);
    assert.strictEqual(result.removedGhostJobs, 0);
  });

  // Nothing can vouch for a payload with no run token; the worker fails it fast instead.
  await check('a malformed job with no run token is left alone', async () => {
    const f = fakes({ entries: [], waiting: [{ id: '6', runToken: '' }] });
    await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.removed, []);
  });

  await check('an active job is never removed', async () => {
    const f = fakes({ entries: [], states: { '4': 'active' }, waiting: [{ id: '4', runToken: 'tok-4' }] });
    const result = await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.removed, [], 'a claimed job must stay with its worker');
    assert.strictEqual(result.removedGhostJobs, 0);
  });

  await check('an entry whose job vanished is cleared', async () => {
    const f = fakes({ entries: [entry({ jobId: '2', runToken: 'tok-2' })], states: { '2': 'unknown' } });
    const result = await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.cleared, ['tok-2']);
    assert.strictEqual(result.clearedEntries, 1);
  });

  // Post-completion refresh: the terminal snapshot (10 min TTL) must outlive the job.
  await check('a terminal entry holding a live snapshot is preserved', async () => {
    const f = fakes({
      entries: [entry({ jobId: '5', runToken: 'tok-5' })],
      states: { '5': 'completed' },
      snapshots: { 'tok-5': { status: 'COMPLETED' } },
    });
    const result = await reconcileRunRegistry(f.registry, f.queue);

    assert.deepStrictEqual(f.cleared, []);
    assert.strictEqual(result.clearedEntries, 0);
  });

  console.log(`registryReconciler.test.ts: ${passed} checks passed`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

// Guards the admission classifier behind the false-QUEUED fix: a run the operator just
// stopped but that is still draining must read 'draining' (so the next launch is deferred,
// not stacked behind its own corpse), while a terminal entry or a dead-worker ghost reads
// 'clearable' so a launch is never blocked forever. Hand-rolled fakes, no Redis.

import assert from 'node:assert/strict';
import { classifyOwnerRun, type OwnerRunRegistry, type OwnerRunQueue } from './ownerRunDisposition.js';
import type { RunRegistryEntry } from './RunRegistry.js';
import { ENGINE_STALE_MS } from '../../application/services/runHealth.js';

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

function fakes(options: { entry?: RunRegistryEntry | null; state?: string; heartbeatAgeMs?: number | null }): {
  registry: OwnerRunRegistry;
  queue: OwnerRunQueue;
} {
  const registry: OwnerRunRegistry = {
    findByRunToken: async () => options.entry ?? null,
    findByOwner: async () => options.entry ?? null,
    readHeartbeatAgeMs: async () => options.heartbeatAgeMs ?? null,
  };
  const queue: OwnerRunQueue = {
    getJobState: async () => options.state ?? 'unknown',
  };
  return { registry, queue };
}

async function run(): Promise<void> {
  console.log('ownerRunDisposition — admission classifier');

  await check('no entry → none', async () => {
    const f = fakes({ entry: null });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'none');
    assert.strictEqual(c.entry, null);
  });

  await check('live job, not stop-requested → resumable', async () => {
    const f = fakes({ entry: entry(), state: 'active' });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'resumable');
  });

  await check('waiting job, not stop-requested → resumable', async () => {
    const f = fakes({ entry: entry(), state: 'waiting' });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'resumable');
  });

  await check('stop-requested + fresh heartbeat → draining', async () => {
    const f = fakes({ entry: entry({ stopRequestedAt: new Date().toISOString() }), state: 'active', heartbeatAgeMs: 1_000 });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'draining');
  });

  await check('stop-requested + no heartbeat yet → draining (absence is not staleness)', async () => {
    const f = fakes({ entry: entry({ stopRequestedAt: new Date().toISOString() }), state: 'active', heartbeatAgeMs: null });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'draining');
  });

  await check('stop-requested + stale heartbeat → clearable (dead-worker ghost)', async () => {
    const f = fakes({ entry: entry({ stopRequestedAt: new Date().toISOString() }), state: 'active', heartbeatAgeMs: ENGINE_STALE_MS + 1_000 });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'clearable');
  });

  await check('terminal job → clearable', async () => {
    const f = fakes({ entry: entry(), state: 'completed' });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'clearable');
  });

  await check("another user's authenticated entry → none (not this requester's)", async () => {
    const f = fakes({ entry: entry({ userId: 'user-2' }), state: 'active' });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: 'user-1' });
    assert.strictEqual(c.disposition, 'none');
    assert.strictEqual(c.entry, null);
  });

  await check('guest entry (null owner) resolved by runToken → classified, not rejected', async () => {
    const f = fakes({ entry: entry({ userId: null }), state: 'active' });
    const c = await classifyOwnerRun(f.registry, f.queue, { userId: null, runToken: 'tok-1' });
    assert.strictEqual(c.disposition, 'resumable');
  });

  console.log(`ownerRunDisposition.test.ts: ${passed} checks passed`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

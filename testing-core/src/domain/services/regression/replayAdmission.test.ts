// replayAdmission — the global cross-operator replay cap. Env is set BEFORE the
// module is imported so the process-global semaphore reads capacity=1, making the
// serialization deterministic. Proves: work runs under a slot, a second request waits
// until the first releases, the slot is freed even when work throws, and the overflow
// path is surfaced as a busy signal.
// Self-executing: `npx tsx src/domain/services/regression/replayAdmission.test.ts`.

import assert from 'node:assert/strict';

process.env.BUGSAFARI_MAX_CONCURRENT_REPLAYS = '1';
process.env.BUGSAFARI_MAX_REPLAY_WAITERS = '1';

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

console.log('replayAdmission — global replay slot');

async function run(): Promise<void> {
  const { withReplaySlot, isReplayBusyError, replayAdmissionStatus } = await import('./replayAdmission.js');

  await check('capacity is read from env (1)', () => {
    assert.equal(replayAdmissionStatus().capacity, 1);
  });

  await check('serializes: a second slot waits until the first releases', async () => {
    const running: string[] = [];
    const gateA = deferred<void>();

    const a = withReplaySlot(async () => {
      running.push('A');
      await gateA.promise;
      return 'A';
    });
    await tick();
    let bStarted = false;
    const b = withReplaySlot(async () => {
      bStarted = true;
      running.push('B');
      return 'B';
    });
    await tick();
    assert.deepEqual(running, ['A'], 'B blocked while A holds the only slot');
    assert.equal(bStarted, false);

    gateA.resolve();
    assert.equal(await a, 'A');
    assert.equal(await b, 'B');
    assert.deepEqual(running, ['A', 'B'], 'B ran only after A released');
  });

  await check('releases the slot even when work throws', async () => {
    await assert.rejects(() => withReplaySlot(async () => { throw new Error('boom'); }));
    // If the slot leaked, this would hang forever; it resolves because the slot freed.
    const after = await withReplaySlot(async () => 'ok');
    assert.equal(after, 'ok');
  });

  await check('overflow past the wait queue is a busy signal', async () => {
    const gate = deferred<void>();
    const holder = withReplaySlot(async () => {
      await gate.promise;
    });
    await tick();
    const waiter = withReplaySlot(async () => undefined); // fills the single waiter slot
    await tick();
    let busy = false;
    try {
      await withReplaySlot(async () => undefined); // no slot, queue full → overflow
    } catch (err) {
      busy = isReplayBusyError(err);
    }
    assert.equal(busy, true, 'third concurrent request rejected as busy');
    gate.resolve();
    await holder;
    await waiter;
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

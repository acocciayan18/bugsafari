// AsyncSemaphore — the primitive behind the global replay cap. Proves the count
// invariant (never more than `capacity` holders), FIFO wakeups, direct permit
// hand-off, idempotent release, and bounded-wait-queue backpressure.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/infrastructure/concurrency/AsyncSemaphore.test.ts`.

import assert from 'node:assert/strict';
import { AsyncSemaphore, SemaphoreOverflowError } from './AsyncSemaphore.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

console.log('AsyncSemaphore — bounded FIFO concurrency');

async function run(): Promise<void> {
  await check('grants up to capacity permits immediately, then blocks', async () => {
    const s = new AsyncSemaphore(2);
    assert.equal(s.available, 2);
    await s.acquire();
    await s.acquire();
    assert.equal(s.available, 0);
    let third = false;
    void s.acquire().then(() => {
      third = true;
    });
    await tick();
    assert.equal(third, false, 'third acquire waits — capacity is enforced');
    assert.equal(s.waiting, 1);
  });

  await check('release hands the permit straight to the next waiter (count invariant)', async () => {
    const s = new AsyncSemaphore(1);
    const r1 = await s.acquire();
    let second: (() => void) | null = null;
    void s.acquire().then((rel) => {
      second = rel;
    });
    await tick();
    assert.equal(second, null, 'still waiting while the permit is held');
    r1();
    await tick();
    assert.notEqual(second, null, 'permit handed to the waiter');
    assert.equal(s.available, 0, 'not double-credited — the waiter holds the only permit');
  });

  await check('waiters wake in FIFO order', async () => {
    const s = new AsyncSemaphore(1);
    const r1 = await s.acquire();
    const order: number[] = [];
    void s.acquire().then((rel) => {
      order.push(1);
      rel();
    });
    void s.acquire().then((rel) => {
      order.push(2);
      rel();
    });
    void s.acquire().then((rel) => {
      order.push(3);
      rel();
    });
    r1();
    await tick();
    await tick();
    await tick();
    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(s.available, 1, 'all permits returned once drained');
  });

  await check('double release is idempotent — never over-credits permits', async () => {
    const s = new AsyncSemaphore(1);
    const r1 = await s.acquire();
    r1();
    r1();
    assert.equal(s.available, 1, 'stays at capacity, not inflated to 2');
  });

  await check('overflows the wait queue with SemaphoreOverflowError', async () => {
    const s = new AsyncSemaphore(1, 1); // 1 permit, 1 waiter max
    await s.acquire(); // holds the permit
    void s.acquire().catch(() => undefined); // fills the single waiter slot
    await tick();
    await assert.rejects(() => s.acquire(), (err: unknown) => err instanceof SemaphoreOverflowError);
  });

  await check('clamps a non-positive/NaN capacity to 1 (never deadlocks)', async () => {
    assert.equal(new AsyncSemaphore(0).available, 1);
    assert.equal(new AsyncSemaphore(-5).available, 1);
    assert.equal(new AsyncSemaphore(Number.NaN).available, 1);
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

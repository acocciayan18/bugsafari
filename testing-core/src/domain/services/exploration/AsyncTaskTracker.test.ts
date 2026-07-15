// Deterministic self-check for the settlement barrier: settle() must not resolve
// while any tracked write is outstanding, must survive a rejecting task, and must
// also await tasks enqueued by an already-settling task. Run with
// `npx tsx src/domain/services/exploration/AsyncTaskTracker.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { AsyncTaskTracker } from './AsyncTaskTracker.js';

let passed = 0;
function check(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().then(() => { passed += 1; console.log(`  ✓ ${name}`); });
}

// A promise plus its resolver, so a test can hold a task "in-flight" deterministically.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

console.log('AsyncTaskTracker — settlement barrier');

async function run(): Promise<void> {
  await check('settle() waits for every in-flight task before resolving', async () => {
    const tracker = new AsyncTaskTracker();
    const a = deferred(), b = deferred();
    let settled = false;
    tracker.track(a.promise);
    tracker.track(b.promise);
    const barrier = tracker.settle().then(() => { settled = true; });

    await Promise.resolve();
    assert.equal(settled, false, 'must not resolve while tasks are pending');
    a.resolve();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(settled, false, 'must still wait for the second task');
    b.resolve();
    await barrier;
    assert.equal(settled, true, 'resolves once all tasks settle');
    assert.equal(tracker.pendingCount, 0, 'pending set drains to empty');
  });

  await check('a rejecting task does not break the barrier', async () => {
    const tracker = new AsyncTaskTracker();
    tracker.track(Promise.reject(new Error('boom')));
    await tracker.settle();
    assert.equal(tracker.pendingCount, 0, 'rejected task is evicted and swallowed');
  });

  await check('tasks enqueued during settling are also awaited', async () => {
    const tracker = new AsyncTaskTracker();
    const first = deferred(), second = deferred();
    tracker.track(first.promise);
    let settled = false;
    const barrier = tracker.settle().then(() => { settled = true; });

    // Enqueue a second task, then let the first settle — settle() must re-check.
    tracker.track(second.promise);
    first.resolve();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(settled, false, 'must await the task enqueued mid-settle');
    second.resolve();
    await barrier;
    assert.equal(settled, true, 'resolves after the late task settles');
  });
}

run().then(() => console.log(`\n${passed} checks passed`)).catch((e) => { console.error(e); process.exit(1); });

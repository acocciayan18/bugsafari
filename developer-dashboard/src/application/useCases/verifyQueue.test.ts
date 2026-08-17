// Single-flight FIFO verify queue — the guard that stops parallel "Verify Fix"
// clicks from firing concurrent replays the backend rejects (a false
// VERIFICATION_FAILED). Proves: at most one replay runs at a time, extra requests
// wait as 'queued' (never a failure), they drain FIFO, executor rejection settles as
// a terminal failed verdict without stalling the queue, duplicates are coalesced, and
// progress frames only animate the running item.
// No framework — run via `npm test`. Exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { VerifyQueue, buildVerifyFailure, type VerifyStatus } from './verifyQueue.js';
import type { VerifyFixRequest, VerifyFixResult, VerifyFixProgress } from '../../types';

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Let all pending microtasks/macrotasks settle (pump() awaits the executor).
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const req = (bugId: string): VerifyFixRequest => ({ sessionId: 'RUN-000001', bugId });
const okResult = (bugId: string): VerifyFixResult => ({
  ok: true,
  verdict: 'RESOLVED',
  reason: 'CLEAN_REPLAY',
  sessionId: 'RUN-000001',
  bugId,
  bugClass: 'XSS',
  stepsReplayed: 3,
  stepStats: { total: 3, executed: 3, skipped: 0, failed: 0, finalStepExecuted: true },
  matchedSignals: [],
  otherSignals: [],
  timelineSource: 'finding',
  summary: 'ok',
  durationMs: 10,
});

// A queue whose executor is externally controllable, recording call order.
function makeQueue() {
  const calls: string[] = [];
  const gates = new Map<string, Deferred<VerifyFixResult>>();
  let latest: Record<string, VerifyStatus> = {};
  const queue = new VerifyQueue(
    (request) => {
      calls.push(request.bugId);
      const gate = deferred<VerifyFixResult>();
      gates.set(request.bugId, gate);
      return gate.promise;
    },
    (statuses) => {
      latest = statuses;
    },
  );
  return {
    queue,
    calls,
    settle: (bugId: string) => gates.get(bugId)!.resolve(okResult(bugId)),
    fail: (bugId: string, message: string) => gates.get(bugId)!.reject(new Error(message)),
    status: (bugId: string): VerifyStatus | undefined => latest[bugId],
  };
}

console.log('verifyQueue — single-flight FIFO verification');

async function run(): Promise<void> {
  await check('runs one at a time; a second enqueue is queued, not run in parallel', async () => {
    const q = makeQueue();
    void q.queue.enqueue(req('A'));
    void q.queue.enqueue(req('B'));
    await tick();
    assert.deepEqual(q.calls, ['A'], 'only A started');
    assert.equal(q.status('A')?.state, 'running');
    assert.equal(q.status('B')?.state, 'queued', 'B waits — never a parallel failure');
  });

  await check('draining is FIFO: B runs only after A settles', async () => {
    const q = makeQueue();
    void q.queue.enqueue(req('A'));
    void q.queue.enqueue(req('B'));
    await tick();
    q.settle('A');
    await tick();
    assert.deepEqual(q.calls, ['A', 'B'], 'B started after A finished');
    assert.equal(q.status('A')?.state, 'done');
    assert.equal(q.status('B')?.state, 'running');
    q.settle('B');
    await tick();
    assert.equal(q.status('B')?.state, 'done');
    assert.equal(q.queue.isBusy(), false, 'queue idle once drained');
  });

  await check('enqueue resolves with the terminal result stored in the status', async () => {
    const q = makeQueue();
    const p = q.queue.enqueue(req('A'));
    await tick();
    q.settle('A');
    const result = await p;
    assert.equal(result.verdict, 'RESOLVED');
    assert.equal((q.status('A') as Extract<VerifyStatus, { state: 'done' }>).result.verdict, 'RESOLVED');
  });

  await check('executor rejection settles as VERIFICATION_FAILED and never stalls the queue', async () => {
    const q = makeQueue();
    const pA = q.queue.enqueue(req('A'));
    void q.queue.enqueue(req('B'));
    await tick();
    q.fail('A', 'socket timeout');
    const rA = await pA;
    assert.equal(rA.verdict, 'VERIFICATION_FAILED');
    assert.equal(rA.error, 'socket timeout');
    await tick();
    assert.equal(q.status('B')?.state, 'running', 'B still drains after A failed');
  });

  await check('duplicate enqueue for the same bug is coalesced (one replay, same promise)', async () => {
    const q = makeQueue();
    const p1 = q.queue.enqueue(req('A'));
    const p2 = q.queue.enqueue(req('A'));
    assert.equal(p1, p2, 'same in-flight promise returned');
    await tick();
    q.settle('A');
    await Promise.all([p1, p2]);
    assert.deepEqual(q.calls, ['A'], 'executor invoked exactly once');
  });

  await check('progress frames animate only the running item, never a queued one', async () => {
    const q = makeQueue();
    void q.queue.enqueue(req('A'));
    void q.queue.enqueue(req('B'));
    await tick();
    const queuedFrame: VerifyFixProgress = { sessionId: 'RUN-000001', bugId: 'B', phase: 'validating', stepsReplayed: 2, totalSteps: 4 };
    q.queue.applyProgress(queuedFrame);
    assert.equal(q.status('B')?.state, 'queued', 'a queued item ignores progress');
    const runningFrame: VerifyFixProgress = { sessionId: 'RUN-000001', bugId: 'A', phase: 'validating', stepsReplayed: 2, totalSteps: 4 };
    q.queue.applyProgress(runningFrame);
    const a = q.status('A') as Extract<VerifyStatus, { state: 'running' }>;
    assert.equal(a.phase, 'validating');
    assert.equal(a.stepsReplayed, 2);
    assert.equal(a.totalSteps, 4);
  });

  await check('buildVerifyFailure produces a terminal failed verdict carrying the message', () => {
    const failed = buildVerifyFailure(req('Z'), 'boom');
    assert.equal(failed.ok, false);
    assert.equal(failed.verdict, 'VERIFICATION_FAILED');
    assert.equal(failed.bugId, 'Z');
    assert.equal(failed.error, 'boom');
  });

  console.log(`\n${passed} checks passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

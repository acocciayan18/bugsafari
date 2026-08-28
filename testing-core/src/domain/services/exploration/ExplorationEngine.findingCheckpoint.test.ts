// Guards the mid-run finding checkpoint — the write that makes a run's findings
// survive a browser refresh, a dropped socket, or a killed worker. Before it existed,
// forensicTrace.caughtBugs was written only at Save, from the BROWSER's buffer.
// Prototype-bypass instances so the heavy constructor never runs; only the private
// fields each method reads are seeded (same pattern as ExplorationEngine.control.test.ts).
// Self-executing: `npx tsx src/domain/services/exploration/ExplorationEngine.findingCheckpoint.test.ts`.

import assert from 'node:assert/strict';
import { ExplorationEngine } from './ExplorationEngine.js';
import type { CheckpointFinding } from '../../repositories/FindingRepository.js';
import type { ConfirmedBug } from './types.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface RecordedCheckpoint { sessionId: string; userId: string; bugs: CheckpointFinding[] }

function fakeRepo(onCall?: () => void) {
  const calls: RecordedCheckpoint[] = [];
  return {
    calls,
    repo: {
      checkpointFindings: async (sessionId: string, userId: string, bugs: CheckpointFinding[]): Promise<void> => {
        onCall?.();
        calls.push({ sessionId, userId, bugs });
      },
    },
  };
}

type Bare = Record<string, unknown>;
function bareEngine(fields: Bare): ExplorationEngine {
  return Object.assign(Object.create(ExplorationEngine.prototype), {
    findingsDirty: false,
    findingsSinceCheckpoint: 0,
    findingCheckpointTimer: null,
    findingCheckpointChain: Promise.resolve(),
    confirmedBugsMemory: [],
    // Settlement barrier the real run uses to await in-flight writes before Pause/Stop.
    asyncTasks: { track: (p: Promise<unknown>) => { void p; } },
    ...fields,
  }) as ExplorationEngine;
}

const flush = (e: ExplorationEngine): Promise<void> =>
  (e as unknown as { flushFindingCheckpoint(): Promise<void> }).flushFindingCheckpoint();
const markDirty = (e: ExplorationEngine): void =>
  (e as unknown as { markFindingsDirty(): void }).markFindingsDirty();
const startTimer = (e: ExplorationEngine): void =>
  (e as unknown as { startFindingCheckpoints(): void }).startFindingCheckpoints();
const priv = (e: ExplorationEngine): Bare => e as unknown as Bare;

function bug(id: string): ConfirmedBug {
  return { bugId: id, type: 'EXCEPTION', message: id, selector: '', payloadUsed: '', advice: '', timestamp: new Date(0) };
}

console.log('ExplorationEngine — durable finding checkpoint');

// A guest run has no session document at all, so there is nothing to checkpoint onto.
// It must cost nothing rather than throw or write under a null id.
await check('a guest run (no sessionId) never writes a checkpoint', async () => {
  const { calls, repo } = fakeRepo();
  const e = bareEngine({ findingRepo: repo, sessionId: null, userId: 'u1', findingsDirty: true, confirmedBugsMemory: [bug('b1')] });
  await flush(e);
  assert.strictEqual(calls.length, 0);
});

await check('an unauthenticated run (no userId) never writes a checkpoint', async () => {
  const { calls, repo } = fakeRepo();
  const e = bareEngine({ findingRepo: repo, sessionId: 's1', userId: undefined, findingsDirty: true, confirmedBugsMemory: [bug('b1')] });
  await flush(e);
  assert.strictEqual(calls.length, 0);
});

// The write is dirty-gated so a quiet run costs one boolean check per tick, not an
// updateOne against Atlas every interval for the whole timebox.
await check('a clean ledger is not rewritten', async () => {
  const { calls, repo } = fakeRepo();
  const e = bareEngine({ findingRepo: repo, sessionId: 's1', userId: 'u1', findingsDirty: false, confirmedBugsMemory: [bug('b1')] });
  await flush(e);
  assert.strictEqual(calls.length, 0, 'nothing changed since the last flush');
});

await check('a dirty ledger is written in the persisted shape and then clean', async () => {
  const { calls, repo } = fakeRepo();
  const e = bareEngine({ findingRepo: repo, sessionId: 's1', userId: 'u1', confirmedBugsMemory: [bug('b1'), bug('b2')] });
  markDirty(e);
  await flush(e);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].sessionId, 's1');
  assert.strictEqual(calls[0].userId, 'u1');
  assert.deepStrictEqual(calls[0].bugs.map((b) => b.bugId), ['b1', 'b2']);
  assert.strictEqual(priv(e).findingsDirty, false, 'a settled flush leaves the ledger clean');
  await flush(e);
  assert.strictEqual(calls.length, 1, 'a second flush with no new findings is a no-op');
});

// A finding registered while the write is in flight must not be swallowed: the dirty
// flag is cleared BEFORE the await, so a concurrent registration re-arms it.
await check('a finding registered mid-write is picked up by the next flush', async () => {
  let e!: ExplorationEngine;
  const { calls, repo } = fakeRepo(() => {
    // Fires inside checkpointFindings, i.e. while the previous flush is awaiting.
    (e as unknown as { confirmedBugsMemory: ConfirmedBug[] }).confirmedBugsMemory.push(bug('late'));
    markDirty(e);
  });
  e = bareEngine({ findingRepo: repo, sessionId: 's1', userId: 'u1', confirmedBugsMemory: [bug('b1')] });
  markDirty(e);
  await flush(e);
  assert.strictEqual(priv(e).findingsDirty, true, 'the mid-write registration must re-arm the flag');
  await flush(e);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[1].bugs.map((b) => b.bugId), ['b1', 'late']);
});

// A transient Atlas blip must not silently drop the run's only durable copy.
await check('a failed write re-arms the dirty flag and never throws', async () => {
  const calls: number[] = [];
  const repo = {
    checkpointFindings: async (): Promise<void> => {
      calls.push(1);
      throw new Error('Atlas unreachable');
    },
  };
  const e = bareEngine({ findingRepo: repo, sessionId: 's1', userId: 'u1', confirmedBugsMemory: [bug('b1')] });
  markDirty(e);
  await flush(e); // must not reject
  assert.strictEqual(priv(e).findingsDirty, true, 'a failed write must be retried, not dropped');
  assert.strictEqual(calls.length, 1);
});

// A burst of findings must not sit exposed for a whole interval waiting on the timer.
await check('a burst past the threshold schedules a flush early', async () => {
  const { calls, repo } = fakeRepo();
  const e = bareEngine({ findingRepo: repo, sessionId: 's1', userId: 'u1' });
  for (let i = 0; i < 5; i++) {
    (e as unknown as { confirmedBugsMemory: ConfirmedBug[] }).confirmedBugsMemory.push(bug(`b${i}`));
    markDirty(e);
  }
  await (priv(e).findingCheckpointChain as Promise<void>);
  assert.strictEqual(calls.length, 1, 'the threshold forces a flush without waiting for the timer');
  assert.strictEqual(priv(e).findingsSinceCheckpoint, 0, 'the burst counter resets on flush');
});

// The timer is the steady-state driver; arming it for a run that can never persist
// would burn an interval for the whole timebox to no effect.
await check('the checkpoint timer is not armed for a run that cannot persist', () => {
  const { repo } = fakeRepo();
  const guest = bareEngine({ findingRepo: repo, sessionId: null, userId: 'u1' });
  startTimer(guest);
  assert.strictEqual(priv(guest).findingCheckpointTimer, null);

  const live = bareEngine({ findingRepo: repo, sessionId: 's1', userId: 'u1' });
  startTimer(live);
  assert.notStrictEqual(priv(live).findingCheckpointTimer, null);
  (live as unknown as { stopFindingCheckpoints(): void }).stopFindingCheckpoints();
  assert.strictEqual(priv(live).findingCheckpointTimer, null, 'teardown clears the interval');
});

console.log(`ExplorationEngine.findingCheckpoint.test.ts: ${passed} checks passed`);

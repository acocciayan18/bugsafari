// Guards raceSlotRelease: the seam that lets the worker's BullMQ processor return
// (freeing the concurrency-1 slot) when a stop is force-released, without leaking an
// unhandled rejection from a wedged run that throws later. Self-executing: `npx tsx slotRelease.test.ts`.

import assert from 'node:assert/strict';
import { raceSlotRelease } from './slotRelease.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const never = (): Promise<void> => new Promise<void>(() => undefined);

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A promptly-resolving execute wins on its own — the clean fast path frees the slot
// as soon as run() unwinds, no force-release needed.
await check('a resolved execute yields completed before any release', async () => {
  const outcome = await raceSlotRelease(Promise.resolve(), never() as Promise<'released'>);
  assert.strictEqual(outcome, 'completed');
});

// A wedged execute never resolves; firing the release signal returns the processor.
await check('a wedged execute is freed by the release signal', async () => {
  let fire: () => void = () => undefined;
  const released = new Promise<'released'>((res) => { fire = () => res('released'); });
  const race = raceSlotRelease(never(), released);
  fire();
  assert.strictEqual(await race, 'released');
});

// A rejecting execute is still terminal (completed), and its rejection must not
// surface as an unhandled rejection that could crash the worker process.
await check('a rejecting execute yields completed with no unhandled rejection', async () => {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { seen.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  const outcome = await raceSlotRelease(Promise.reject(new Error('teardown blew up')), never() as Promise<'released'>);
  await delay(10); // let any stray microtask/unhandled-rejection settle
  process.off('unhandledRejection', onUnhandled);
  assert.strictEqual(outcome, 'completed');
  assert.strictEqual(seen.length, 0, 'the losing rejected branch must be swallowed');
});

console.log(`slotRelease.test.ts: ${passed} checks passed`);

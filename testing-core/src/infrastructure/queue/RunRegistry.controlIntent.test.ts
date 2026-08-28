// Guards the durable pause/resume intent's ordering rule. Stop always had a backstop
// (stopRequestedAt); pause and resume rode Redis pub/sub alone, which has no
// persistence — a command published while the worker was mid-reconnect was simply lost
// and the dashboard sat in PAUSING with nothing to recover it. The worker now polls the
// intent on the tick it already runs, so the seq rule is what keeps that poll idempotent.
// Pure predicate, no Redis. Self-executing: `npx tsx RunRegistry.controlIntent.test.ts`.

import assert from 'node:assert/strict';
import { shouldApplyControlIntent, type RunControlIntent } from './RunRegistry.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const intent = (command: 'pause' | 'resume', seq: number): RunControlIntent =>
  ({ command, seq, at: new Date(0).toISOString() });

console.log('RunRegistry — durable control intent');

check('no intent recorded is a no-op', () => {
  assert.strictEqual(shouldApplyControlIntent(undefined, 0), false);
});

check('a first intent applies', () => {
  assert.strictEqual(shouldApplyControlIntent(intent('pause', 1), 0), true);
});

// The worker polls every ~3s for the whole run. Re-applying the same intent each tick
// would fight the operator: a pause would be re-issued forever after a manual resume.
check('an already-applied intent never re-fires', () => {
  assert.strictEqual(shouldApplyControlIntent(intent('pause', 1), 1), false);
  assert.strictEqual(shouldApplyControlIntent(intent('pause', 3), 5), false, 'a stale intent is ignored');
});

check('a newer intent supersedes the applied one', () => {
  assert.strictEqual(shouldApplyControlIntent(intent('resume', 2), 1), true);
});

// Rapid pause → resume must land on resume, not be collapsed away.
check('a rapid pause then resume applies both in order', () => {
  let applied = 0;
  const sequence: RunControlIntent[] = [intent('pause', 1), intent('resume', 2)];
  const seen: string[] = [];
  for (const next of sequence) {
    if (shouldApplyControlIntent(next, applied)) {
      applied = next.seq;
      seen.push(next.command);
    }
  }
  assert.deepStrictEqual(seen, ['pause', 'resume']);
  assert.strictEqual(applied, 2);
});

// A corrupted entry must not be treated as an infinitely-new command.
check('a malformed seq is refused', () => {
  assert.strictEqual(shouldApplyControlIntent({ command: 'pause', seq: NaN, at: '' }, 0), false);
  assert.strictEqual(shouldApplyControlIntent({ command: 'pause', seq: Infinity, at: '' }, 0), false);
});

console.log(`RunRegistry.controlIntent.test.ts: ${passed} checks passed`);

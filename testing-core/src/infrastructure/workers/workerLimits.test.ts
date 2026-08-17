// Guards the must-fix: the BullMQ job lock must outlast the longest possible run,
// or a 20-30 min job that briefly stalls the event loop is re-delivered as a
// duplicate. Self-executing (no unit runner): `npx tsx workerLimits.test.ts`.

import assert from 'node:assert/strict';
import { MAX_TIMEBOX_MS } from '../../../../shared/types.js';
import { SAFARI_JOB_LOCK_DURATION_MS } from './workerLimits.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('job lock strictly exceeds the maximum timebox', () => {
  assert.ok(SAFARI_JOB_LOCK_DURATION_MS > MAX_TIMEBOX_MS, 'lock must outlast the longest run');
});

check('job lock leaves teardown headroom past the max timebox', () => {
  assert.ok(SAFARI_JOB_LOCK_DURATION_MS - MAX_TIMEBOX_MS >= 30_000, 'headroom covers a settle window');
});

console.log(`workerLimits.test.ts: ${passed} checks passed`);

// Standalone deterministic tests for the retention sweep rule. Self-executing:
// run with `npx tsx src/infrastructure/database/reapPolicy.test.ts`.
// Exits non-zero on the first failed assertion.
//
// The sweep deletes rows, so its selection rule is the part that must be exactly
// right: a false positive destroys a live run's forensics.

import assert from 'node:assert/strict';
import { selectOrphans } from './reapPolicy.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('reapPolicy — only children of a vanished session are swept');

check('a child whose session survives is never selected', () => {
  assert.deepEqual(selectOrphans(['a', 'b'], ['a', 'b']), []);
});

check('a child whose session is gone is selected', () => {
  assert.deepEqual(selectOrphans(['a', 'b', 'c'], ['b']), ['a', 'c']);
});

check('an empty surviving set means the whole batch is orphaned', () => {
  assert.deepEqual(selectOrphans(['a', 'b'], []), ['a', 'b']);
});

check('an empty batch selects nothing', () => {
  assert.deepEqual(selectOrphans([], ['a']), []);
});

check('surviving ids outside the batch never widen the selection', () => {
  // The caller queries sessions by the batch, but a stale/over-broad survivor
  // list must not cause anything extra to be deleted.
  assert.deepEqual(selectOrphans(['a'], ['a', 'z']), []);
});

check('ids are matched by string form, not identity', () => {
  // Real ids are ObjectIds on one side and strings from .lean() on the other.
  const oid = { toString: () => '507f1f77bcf86cd799439011' };
  const other = { toString: () => '507f1f77bcf86cd799439012' };
  assert.deepEqual(selectOrphans([oid, other], ['507f1f77bcf86cd799439011']), [other]);
});

check('batch order is preserved so deletes stay deterministic', () => {
  assert.deepEqual(selectOrphans(['c', 'a', 'b'], ['a']), ['c', 'b']);
});

console.log(`\n${passed} checks passed`);

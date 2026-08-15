// Standalone deterministic tests for the soft-delete bucket mapping. Self-executing:
// run with `npx tsx src/infrastructure/database/sessionState.test.ts`.
// Exits non-zero on the first failed assertion.
//
// These two pure functions decide which rows land in Active/Archived/Trash and how
// each row reports its own bucket — a drift between them would show a session in the
// wrong tab or offer the wrong destructive action, so they are pinned here.

import assert from 'node:assert/strict';
import { sessionStateFilter, sessionHistoryState } from './sessionState.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('sessionState — bucket filters and doc classification');

check('active filter excludes both tombstones (null matches missing legacy fields)', () => {
  assert.deepEqual(sessionStateFilter('active'), { archivedAt: null, deletedAt: null });
});

check('archived filter requires an archive stamp and no trash stamp', () => {
  assert.deepEqual(sessionStateFilter('archived'), { archivedAt: { $ne: null }, deletedAt: null });
});

check('trashed filter keys only off the trash stamp', () => {
  assert.deepEqual(sessionStateFilter('trashed'), { deletedAt: { $ne: null } });
});

check('a doc with neither stamp is active', () => {
  assert.equal(sessionHistoryState({}), 'active');
  assert.equal(sessionHistoryState({ archivedAt: null, deletedAt: null }), 'active');
});

check('an archived-only doc is archived', () => {
  assert.equal(sessionHistoryState({ archivedAt: new Date(), deletedAt: null }), 'archived');
});

check('any trash stamp wins over an archive stamp', () => {
  assert.equal(sessionHistoryState({ deletedAt: new Date() }), 'trashed');
  assert.equal(sessionHistoryState({ archivedAt: new Date(), deletedAt: new Date() }), 'trashed');
});

console.log(`\nsessionState: ${passed} checks passed.`);

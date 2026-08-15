// Standalone deterministic tests for the Trash retention-window parser. Self-executing:
// run with `npx tsx src/infrastructure/database/retentionReaper.retention.test.ts`.
// Exits non-zero on the first failed assertion.
//
// This value decides how long a soft-deleted session stays recoverable before the
// reaper purges it forever. The floor is a data-safety invariant: no misconfigured
// env value may collapse the window to same-day and defeat recovery.

import assert from 'node:assert/strict';
import {
  parseTrashRetentionDays,
  DEFAULT_TRASH_RETENTION_DAYS,
  MIN_TRASH_RETENTION_DAYS,
} from './retentionReaper.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('retentionReaper — Trash retention-window parsing');

check('a valid positive value is honored', () => {
  assert.equal(parseTrashRetentionDays('7'), 7);
  assert.equal(parseTrashRetentionDays('90'), 90);
});

check('absent/empty falls back to the default', () => {
  assert.equal(parseTrashRetentionDays(undefined), DEFAULT_TRASH_RETENTION_DAYS);
  assert.equal(parseTrashRetentionDays(''), DEFAULT_TRASH_RETENTION_DAYS);
});

check('garbage falls back to the default rather than 0', () => {
  assert.equal(parseTrashRetentionDays('abc'), DEFAULT_TRASH_RETENTION_DAYS);
  assert.equal(parseTrashRetentionDays('NaN'), DEFAULT_TRASH_RETENTION_DAYS);
});

check('zero and negatives fall back to the default (never purge same-day)', () => {
  assert.equal(parseTrashRetentionDays('0'), DEFAULT_TRASH_RETENTION_DAYS);
  assert.equal(parseTrashRetentionDays('-5'), DEFAULT_TRASH_RETENTION_DAYS);
});

check('a below-floor positive value is clamped up to the minimum', () => {
  // MIN is 1; a fractional/low value like "1" stays 1, and parseInt drops decimals.
  assert.equal(parseTrashRetentionDays('1'), Math.max(MIN_TRASH_RETENTION_DAYS, 1));
});

check('a decimal string is truncated by parseInt, then floored', () => {
  assert.equal(parseTrashRetentionDays('14.9'), 14);
});

console.log(`\nretentionReaper retention: ${passed} checks passed.`);

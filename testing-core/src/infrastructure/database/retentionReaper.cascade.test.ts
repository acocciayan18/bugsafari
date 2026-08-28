// Pins share links into the delete cascade: a permanently deleted (or reaper-purged,
// or orphaned) report must NOT stay publicly readable through an active share link.
// All three delete paths iterate CHILD_COLLECTIONS, so membership here is the
// regression guard. Schema/const introspection only — no live DB.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { CHILD_COLLECTIONS } from './retentionReaper.js';
import { ShareLinkModel } from './models/ShareLinkModel.js';

function check(name: string, fn: () => void): void {
  fn();
  console.log(`  ✓ ${name}`);
}

console.log('\nretentionReaper — share-link cascade contract');

check('sharelinks is in the delete cascade, keyed by sessionId', () => {
  const entry = CHILD_COLLECTIONS.find((c) => c.name === ShareLinkModel.collection.collectionName);
  assert.ok(entry, 'ShareLink collection must be a cascade child so it dies with a permanent delete');
  assert.equal(entry.field, 'sessionId', 'share links back-reference their session via sessionId');
});

console.log('\nretentionReaper cascade: all checks passed.');

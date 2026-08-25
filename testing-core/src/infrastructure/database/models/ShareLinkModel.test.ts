// Pins the ShareLink index/constraint surface: the TTL reaper, the unique token,
// and the partial-unique active-link guarantee (one live link per user·session·ttl)
// behind create-or-reuse. Schema introspection only — no live DB.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { ShareLinkModel } from './ShareLinkModel.js';

function check(name: string, fn: () => void): void {
  fn();
  console.log(`  ✓ ${name}`);
}

const indexes = ShareLinkModel.schema.indexes();
const findIndex = (pred: (key: Record<string, number>, opts: Record<string, unknown>) => boolean) =>
  indexes.find(([key, opts]) => pred(key as Record<string, number>, (opts ?? {}) as Record<string, unknown>));

console.log('\nShareLinkModel — index & constraint contract');

check('token carries a unique index (no two links share a credential)', () => {
  assert.equal(ShareLinkModel.schema.path('token').options.unique, true);
});

check('a TTL index reaps rows at expiresAt', () => {
  const ttl = findIndex((key, opts) => key.expiresAt === 1 && opts.expireAfterSeconds === 0);
  assert.ok(ttl, 'expected an { expiresAt: 1 } TTL index with expireAfterSeconds: 0');
});

check('a partial-unique index enforces one active link per user·session·ttl', () => {
  const uniq = findIndex(
    (key, opts) => key.userId === 1 && key.sessionId === 1 && key.expiresIn === 1 && opts.unique === true,
  );
  assert.ok(uniq, 'expected a unique compound index on userId+sessionId+expiresIn');
  const opts = uniq![1] as { partialFilterExpression?: Record<string, unknown> };
  assert.deepEqual(
    opts.partialFilterExpression,
    { revokedAt: null },
    'uniqueness must be partial to revokedAt:null so revoked rows never collide',
  );
});

check('the owner management-list index is present', () => {
  const list = findIndex((key) => key.userId === 1 && key.sessionId === 1 && key.createdAt === -1);
  assert.ok(list, 'expected { userId:1, sessionId:1, createdAt:-1 } for the owner list');
});

check('a well-formed link document validates; a link missing its snapshot does not', () => {
  const base = {
    token: 'abc', sessionId: new Types.ObjectId(), runId: 'RUN-1', userId: new Types.ObjectId(),
    expiresIn: '7d', expiresAt: new Date(),
  };
  assert.equal(new ShareLinkModel({ ...base, snapshot: { report: 1 } }).validateSync(), undefined, 'valid doc must pass');
  assert.ok(new ShareLinkModel(base).validateSync(), 'snapshot is required');
});

console.log('\nShareLinkModel: 5 checks passed.');

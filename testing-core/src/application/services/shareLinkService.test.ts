// Duplicate-prevention, reuse, cap, revive, race, and token-security contract for
// the share-link service. DB-free: an in-memory ShareLinkStore models the partial-
// unique (one active row per user·session·ttl) semantics the Mongo impl enforces.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import {
  generateShareToken,
  isReusableLink,
  isShareSnapshotServable,
  computeExpiresAt,
  createOrReuseShareLink,
  MAX_ACTIVE_SHARE_LINKS,
  ShareLinkLimitError,
  SnapshotUnavailableError,
  DuplicateShareKeyError,
  type ShareLinkStore,
  type StoredShareLink,
} from './shareLinkService.js';
import { SHARE_TTL_MS, type ShareTtl } from '../../../../shared/types.js';

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => console.log(`  ✓ ${name}`));
}

const KEY = { userId: 'user-1', sessionId: 'session-1' };
const T0 = new Date('2026-01-01T00:00:00.000Z');

interface Row extends StoredShareLink { userId: string; sessionId: string; expiresIn: ShareTtl; }

// In-memory store mirroring the Mongo guarantee: at most one non-revoked row per
// (user, session, ttl). upsertActive inserts or revives that single row.
function makeStore(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let seq = seed.length;
  const store: ShareLinkStore = {
    async findActiveByTtl(key, ttl, now) {
      return (
        rows
          .filter((r) => r.userId === key.userId && r.sessionId === key.sessionId && isReusableLink(r, ttl, now))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    },
    async countActive(key, now) {
      return rows.filter(
        (r) => r.userId === key.userId && r.sessionId === key.sessionId && !r.revokedAt && r.expiresAt.getTime() > now.getTime(),
      ).length;
    },
    async upsertActive(input) {
      const existing = rows.find(
        (r) => r.userId === input.userId && r.sessionId === input.sessionId && r.expiresIn === input.ttl && !r.revokedAt,
      );
      if (existing) {
        existing.token = input.token;
        existing.expiresAt = input.expiresAt;
        return { link: existing, created: false };
      }
      const row: Row = {
        _id: `id-${(seq += 1)}`, userId: input.userId, sessionId: input.sessionId, token: input.token,
        expiresIn: input.ttl, expiresAt: input.expiresAt, revokedAt: null, createdAt: new Date(T0.getTime() + seq),
      };
      rows.push(row);
      return { link: row, created: true };
    },
  };
  return { store, rows };
}

function activeRow(ttl: ShareTtl, overrides: Partial<Row> = {}): Row {
  return {
    _id: `seed-${ttl}`, userId: KEY.userId, sessionId: KEY.sessionId, token: `tok-${ttl}`,
    expiresIn: ttl, expiresAt: new Date(T0.getTime() + SHARE_TTL_MS[ttl]), revokedAt: null, createdAt: T0, ...overrides,
  };
}

function deps(built: { count: number }) {
  return {
    now: () => T0,
    buildSnapshot: async () => {
      built.count += 1;
      return { report: 'frozen' } as Record<string, unknown>;
    },
  };
}

async function main(): Promise<void> {
  console.log('\nshareLinkService — duplicate prevention, reuse, race, tokens');

  await check('generateShareToken is url-safe, 256-bit, and collision-free across draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const t = generateShareToken();
      assert.match(t, /^[A-Za-z0-9_-]+$/, 'token must be base64url');
      assert.equal(Buffer.from(t, 'base64url').length, 32, 'token must decode to 32 bytes');
      assert.ok(!seen.has(t), 'tokens must be unique');
      seen.add(t);
    }
  });

  await check('isReusableLink matches ttl and rejects revoked / expired / wrong-ttl', () => {
    assert.equal(isReusableLink(activeRow('7d'), '7d', T0), true);
    assert.equal(isReusableLink(activeRow('7d'), '24h', T0), false, 'different ttl is not reusable');
    assert.equal(isReusableLink(activeRow('7d', { revokedAt: T0 }), '7d', T0), false, 'revoked is not reusable');
    const expired = activeRow('7d', { expiresAt: new Date(T0.getTime() - 1) });
    assert.equal(isReusableLink(expired, '7d', T0), false, 'expired is not reusable');
  });

  await check('computeExpiresAt applies the preset window', () => {
    assert.equal(computeExpiresAt('1h', T0).getTime(), T0.getTime() + SHARE_TTL_MS['1h']);
    assert.equal(computeExpiresAt('30d', T0).getTime(), T0.getTime() + SHARE_TTL_MS['30d']);
  });

  await check('isShareSnapshotServable blocks revoked links even before expiry, and expired links', () => {
    const future = new Date(T0.getTime() + SHARE_TTL_MS['30d']);
    assert.equal(isShareSnapshotServable({ revokedAt: null, expiresAt: future }, T0), true, 'live unrevoked serves');
    assert.equal(isShareSnapshotServable({ revokedAt: T0, expiresAt: future }, T0), false, 'revoked never serves, expiry in the future notwithstanding');
    assert.equal(isShareSnapshotServable({ revokedAt: null, expiresAt: new Date(T0.getTime() - 1) }, T0), false, 'expired never serves');
    assert.equal(isShareSnapshotServable({ expiresAt: future }, T0), true, 'absent revokedAt is treated as live');
  });

  await check('repeated create with the same ttl reuses one row and rebuilds no snapshot', async () => {
    const { store, rows } = makeStore();
    const built = { count: 0 };
    const first = await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built));
    const second = await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built));
    const third = await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built));
    assert.equal(first.reused, false, 'first mints');
    assert.equal(second.reused, true, 'second reuses');
    assert.equal(third.reused, true, 'third reuses');
    assert.equal(first.link.token, second.link.token, 'reuse returns the same token');
    assert.equal(rows.length, 1, 'no duplicate rows');
    assert.equal(built.count, 1, 'snapshot frozen exactly once');
  });

  await check('a different ttl mints a distinct link (legitimate, not a duplicate)', async () => {
    const { store, rows } = makeStore();
    const built = { count: 0 };
    await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built));
    const other = await createOrReuseShareLink(store, KEY, '24h', 'RUN-1', deps(built));
    assert.equal(other.reused, false);
    assert.equal(rows.length, 2, 'one row per ttl');
  });

  await check('concurrent identical creates converge on a single row', async () => {
    const { store, rows } = makeStore();
    const built = { count: 0 };
    // Both observe no active link (same tick), then both upsert — the store's
    // single-active-row rule collapses them to one, exactly as the unique index does.
    const [a, b] = await Promise.all([
      createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built)),
      createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built)),
    ]);
    assert.equal(rows.length, 1, 'concurrency never duplicates the active row');
    assert.equal(a.link.token, b.link.token, 'both callers see the surviving row');
  });

  await check('a lost upsert race (DuplicateShareKeyError) falls back to the winner link', async () => {
    const winner = activeRow('7d');
    let calls = 0;
    const store: ShareLinkStore = {
      // First lookup: nothing active (both racers proceed). Retry lookup: winner exists.
      async findActiveByTtl() { calls += 1; return calls === 1 ? null : winner; },
      async countActive() { return 0; },
      async upsertActive() { throw new DuplicateShareKeyError(); },
    };
    const built = { count: 0 };
    const result = await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built));
    assert.equal(result.reused, true, 'race loser reuses the winner');
    assert.equal(result.link.token, winner.token);
  });

  await check('an expired non-revoked link is revived, not duplicated', async () => {
    const stale = activeRow('7d', { _id: 'stale', expiresAt: new Date(T0.getTime() - 1) });
    const { store, rows } = makeStore([stale]);
    const built = { count: 0 };
    const result = await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps(built));
    assert.equal(result.reused, false, 'revive is a fresh link');
    assert.equal(result.link._id, 'stale', 'the same row is revived in place');
    assert.equal(rows.length, 1, 'no duplicate on revive');
    assert.ok(result.link.expiresAt.getTime() > T0.getTime(), 'expiry pushed into the future');
  });

  await check('the per-record active cap is enforced before any snapshot is built', async () => {
    const seed = Array.from({ length: MAX_ACTIVE_SHARE_LINKS }, (_, i) =>
      activeRow('30d', { _id: `cap-${i}`, expiresIn: '30d', createdAt: new Date(T0.getTime() + i) }),
    );
    const { store, rows } = makeStore(seed);
    const built = { count: 0 };
    await assert.rejects(
      () => createOrReuseShareLink(store, KEY, '24h', 'RUN-1', deps(built)),
      ShareLinkLimitError,
    );
    assert.equal(built.count, 0, 'cap trips before the costly snapshot build');
    assert.equal(rows.length, MAX_ACTIVE_SHARE_LINKS, 'nothing added past the cap');
  });

  await check('a missing report surfaces SnapshotUnavailableError (no row written)', async () => {
    const { store, rows } = makeStore();
    await assert.rejects(
      () => createOrReuseShareLink(store, KEY, '7d', 'RUN-1', { now: () => T0, buildSnapshot: async () => null }),
      SnapshotUnavailableError,
    );
    assert.equal(rows.length, 0);
  });

  await check('the service stays tenant-scoped — every store call carries the caller key', async () => {
    const seenKeys: string[] = [];
    const store: ShareLinkStore = {
      async findActiveByTtl(key) { seenKeys.push(`${key.userId}/${key.sessionId}`); return null; },
      async countActive(key) { seenKeys.push(`${key.userId}/${key.sessionId}`); return 0; },
      async upsertActive(input) {
        seenKeys.push(`${input.userId}/${input.sessionId}`);
        return { link: activeRow('7d', { token: input.token }), created: true };
      },
    };
    await createOrReuseShareLink(store, KEY, '7d', 'RUN-1', deps({ count: 0 }));
    assert.ok(seenKeys.length >= 3, 'lookup, count, and upsert all ran');
    assert.ok(seenKeys.every((k) => k === `${KEY.userId}/${KEY.sessionId}`), 'no store call widened the tenant scope');
  });

  console.log('\nshareLinkService: all checks passed.');
}

await main();

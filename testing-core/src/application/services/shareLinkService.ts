// Create-or-reuse orchestration for view-only share links. Depends on a tiny
// ShareLinkStore port (not the Mongoose model) so the dedup/race/cap policy is
// unit-testable with an in-memory fake. The route supplies a Mongo-backed store.

import { randomBytes } from 'node:crypto';
import { SHARE_TTL_MS, type ShareTtl } from '../../../../shared/types.js';

// At most this many live (unrevoked, unexpired) links per record — bounds snapshot
// storage. With the partial-unique index this is effectively the preset count.
export const MAX_ACTIVE_SHARE_LINKS = 10;

// Opaque, URL-safe credential — 256 bits of entropy, unguessable.
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

// Owner-scoped identity of the record a link belongs to (hex id strings).
export interface ShareLinkKey {
  userId: string;
  sessionId: string;
}

// Minimal persisted shape the policy reasons over — the store returns this.
export interface StoredShareLink {
  _id: unknown;
  token: string;
  expiresIn: ShareTtl;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
}

export interface UpsertShareLinkInput extends ShareLinkKey {
  ttl: ShareTtl;
  token: string;
  runId: string;
  snapshot: Record<string, unknown>;
  expiresAt: Date;
}

// Persistence port. The Mongo impl enforces one active row per (user, session, ttl)
// via a partial-unique index; a lost upsert race surfaces as DuplicateShareKeyError.
export interface ShareLinkStore {
  findActiveByTtl(key: ShareLinkKey, ttl: ShareTtl, now: Date): Promise<StoredShareLink | null>;
  countActive(key: ShareLinkKey, now: Date): Promise<number>;
  upsertActive(input: UpsertShareLinkInput): Promise<{ link: StoredShareLink; created: boolean }>;
}

export interface CreateShareDeps {
  now: () => Date;
  buildSnapshot: () => Promise<Record<string, unknown> | null>;
  token?: () => string;
}

// reused=true means an existing active link was returned with no snapshot built.
export interface CreateShareResult {
  link: StoredShareLink;
  reused: boolean;
}

export class ShareLinkLimitError extends Error {}
export class SnapshotUnavailableError extends Error {}
export class DuplicateShareKeyError extends Error {}

// A link is reusable for `ttl` only if it matches that ttl and is still live.
export function isReusableLink(link: StoredShareLink, ttl: ShareTtl, now: Date): boolean {
  return link.expiresIn === ttl && !link.revokedAt && link.expiresAt.getTime() > now.getTime();
}

export function computeExpiresAt(ttl: ShareTtl, now: Date): Date {
  return new Date(now.getTime() + SHARE_TTL_MS[ttl]);
}

// Read-side guard for the public route: a link is servable only while it is
// unrevoked AND unexpired. Revoked kills access immediately, even before expiry.
export function isShareSnapshotServable(link: { revokedAt?: Date | null; expiresAt: Date }, now: Date): boolean {
  return !link.revokedAt && link.expiresAt.getTime() > now.getTime();
}

// Minimal read-side shape of a persisted link the public route resolves.
export interface ServableShareLink {
  snapshot: Record<string, unknown>;
  expiresAt: Date;
  revokedAt?: Date | null;
}

export type ShareReadOutcome =
  | { gone: true }
  | { gone: false; report: Record<string, unknown> };

// Live-first read policy: after the security gate passes, serve the freshly-rebuilt
// report so a shared view reflects later edits (suggested fix, verify verdict,
// severity, repro) exactly as the owner sees them. Fall back to the frozen snapshot
// only when the origin session no longer exists (deleted before TTL reap). loadLive
// errors degrade to the snapshot rather than break a valid link.
export async function resolveSharedReport(
  link: ServableShareLink,
  now: Date,
  loadLive: () => Promise<Record<string, unknown> | null>,
): Promise<ShareReadOutcome> {
  if (!isShareSnapshotServable(link, now)) return { gone: true };
  const live = await loadLive().catch(() => null);
  return { gone: false, report: live ?? link.snapshot };
}

// Reuse an active same-ttl link; else cap-check, freeze a snapshot, and atomically
// insert-or-revive the single active row. A lost race falls back to the winner's row.
export async function createOrReuseShareLink(
  store: ShareLinkStore,
  key: ShareLinkKey,
  ttl: ShareTtl,
  runId: string,
  deps: CreateShareDeps,
): Promise<CreateShareResult> {
  const now = deps.now();

  const existing = await store.findActiveByTtl(key, ttl, now);
  if (existing) return { link: existing, reused: true };

  const active = await store.countActive(key, now);
  if (active >= MAX_ACTIVE_SHARE_LINKS) throw new ShareLinkLimitError();

  const snapshot = await deps.buildSnapshot();
  if (!snapshot) throw new SnapshotUnavailableError();

  const mint = deps.token ?? generateShareToken;
  const expiresAt = computeExpiresAt(ttl, now);
  try {
    const { link } = await store.upsertActive({ ...key, ttl, token: mint(), runId, snapshot, expiresAt });
    return { link, reused: false };
  } catch (err) {
    if (err instanceof DuplicateShareKeyError) {
      const raced = await store.findActiveByTtl(key, ttl, now);
      if (raced) return { link: raced, reused: true };
    }
    throw err;
  }
}

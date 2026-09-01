import { Schema, model, Document, Types } from 'mongoose';
import type { ShareTtl } from '../../../../../shared/types.js';

// A persisted view-only share link. The public read rebuilds the report LIVE from
// the owned session so a shared view reflects later edits (verify/insights/severity);
// the FROZEN snapshot here is the fallback for when that session no longer exists
// (deleted before reap). Revocable before expiry. Mongo TTL-reaps the row at expiresAt.
export interface IShareLink extends Document {
  // Opaque high-entropy URL credential (base64url). Unguessable; the only key a
  // public viewer presents. Stored as-is so the owner's management UI can re-copy it.
  token: string;
  // Origin session — owner scope for the live read rebuild, and grouping/listing.
  sessionId: Types.ObjectId;
  // Public RUN- code copied at share time, for display in the management list.
  runId: string;
  userId: Types.ObjectId;
  expiresIn: ShareTtl;
  expiresAt: Date;
  // Set on manual revoke — an unexpired-but-revoked row is retained (and rejected
  // on read) until its expiry, then TTL-reaped like any other.
  revokedAt?: Date | null;
  // Frozen ForensicReportResponse captured at share time — the deletion fallback for
  // the live read. Mixed: an already-assembled, sanitized report object.
  snapshot: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const shareLinkSchema = new Schema<IShareLink>(
  {
    token: { type: String, required: true, unique: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    runId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresIn: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'sharelinks' },
);

// Owner-scoped management list: newest links for one session first.
shareLinkSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });
// Mongo reaps expired links automatically — expiry, not a cron, is the cleanup.
shareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// At most one non-revoked link per (user, record, ttl): the DB-level guarantee behind
// create-or-reuse. Partial so revoked rows never collide; caps active rows per record
// at the preset count and makes concurrent creates race-safe (loser hits E11000).
shareLinkSchema.index(
  { userId: 1, sessionId: 1, expiresIn: 1 },
  { unique: true, partialFilterExpression: { revokedAt: null }, name: 'uniq_active_share_per_ttl' },
);

export const ShareLinkModel = model<IShareLink>('ShareLink', shareLinkSchema);

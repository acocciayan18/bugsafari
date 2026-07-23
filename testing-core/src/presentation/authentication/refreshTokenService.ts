import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { RefreshTokenModel } from '../../infrastructure/database/models/RefreshTokenModel.js';
import { AUTH_CONFIG } from './authConfig.js';

export interface IssuedTokens {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export type RotationFailure =
  | 'MALFORMED'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REUSE_DETECTED'
  | 'REVOKED';

export type RotationResult =
  | { ok: true; tokens: IssuedTokens; userId: string; email: string }
  | { ok: false; reason: RotationFailure };

const REFRESH_BYTES = 48;

// Peppered digest: a database read alone yields no usable refresh token, and the
// digest stays deterministic so it can still be looked up by index.
function hashToken(token: string): string {
  return createHmac('sha256', AUTH_CONFIG.JWT_SECRET).update(token).digest('hex');
}

function signAccessToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, AUTH_CONFIG.JWT_SECRET, {
    expiresIn: AUTH_CONFIG.ACCESS_TOKEN_TTL,
  } as jwt.SignOptions);
}

// Issue a fresh access/refresh pair and open a new rotation family.
export async function issueTokenPair(userId: string, email: string): Promise<IssuedTokens> {
  return mintPair(userId, email, randomUUID());
}

async function mintPair(userId: string, email: string, familyId: string): Promise<IssuedTokens> {
  const refreshToken = randomBytes(REFRESH_BYTES).toString('base64url');
  await RefreshTokenModel.create({
    tokenHash: hashToken(refreshToken),
    userId: new Types.ObjectId(userId),
    familyId,
    expiresAt: new Date(Date.now() + AUTH_CONFIG.REFRESH_TOKEN_TTL_MS),
  });
  return {
    token: signAccessToken(userId, email),
    refreshToken,
    // Seconds, per the OAuth convention a standards-following client expects —
    // the access token is signed with a matching TTL (ACCESS_TOKEN_TTL '30m').
    expiresIn: Math.floor(AUTH_CONFIG.ACCESS_TOKEN_TTL_MS / 1000),
  };
}

// Consume a refresh token, revoke it, and mint its successor in the same family.
// Presenting an already-revoked token means the value leaked and is being
// replayed, so the whole family is burned and the session must re-authenticate.
export async function rotateRefreshToken(presented: unknown): Promise<RotationResult> {
  if (typeof presented !== 'string' || presented.length < 32 || presented.length > 512) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const tokenHash = hashToken(presented);
  const now = new Date();

  // Atomic single-use consume-and-revoke. Only ONE presentation can flip the live
  // row to revoked; the unique tokenHash index guarantees a single matching doc,
  // so concurrent replays can't both mint a successor. This is the whole security
  // value of rotation — a non-atomic read-then-write lost it under concurrency.
  const consumed = await RefreshTokenModel.findOneAndUpdate(
    { tokenHash, revokedAt: { $exists: false } },
    { $set: { revokedAt: now, revokedReason: 'rotated' } },
  );

  if (!consumed) {
    // No live row matched: the token never existed, or it existed already-revoked
    // (a replay of a rotated/burned value). Burn the whole family on reuse.
    const existing = await RefreshTokenModel.findOne({ tokenHash }).select('familyId userId');
    if (!existing) return { ok: false, reason: 'NOT_FOUND' };
    console.error(`[AUTH] Refresh token reuse detected for user ${existing.userId} — revoking family ${existing.familyId}`);
    await revokeFamily(existing.familyId, 'reuse-detected');
    return { ok: false, reason: 'REUSE_DETECTED' };
  }

  // `consumed` is the pre-update document (revokedAt was absent when it matched).
  if (consumed.expiresAt.getTime() <= now.getTime()) {
    await RefreshTokenModel.updateOne({ _id: consumed._id }, { $set: { revokedReason: 'expired' } });
    return { ok: false, reason: 'EXPIRED' };
  }

  const { UserModel } = await import('../../infrastructure/database/models/UserModel.js');
  const user = await UserModel.findById(consumed.userId).select('email');
  if (!user) {
    await revokeFamily(consumed.familyId, 'user-missing');
    return { ok: false, reason: 'REVOKED' };
  }

  const tokens = await mintPair(consumed.userId.toString(), user.email, consumed.familyId);
  return { ok: true, tokens, userId: consumed.userId.toString(), email: user.email };
}

export async function revokeFamily(familyId: string, reason: string): Promise<void> {
  await RefreshTokenModel.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { revokedAt: new Date(), revokedReason: reason },
  );
}

// Used on logout (single token) — silently no-ops on an unknown value.
export async function revokeToken(presented: unknown, reason: string): Promise<void> {
  if (typeof presented !== 'string' || !presented) return;
  await RefreshTokenModel.updateOne(
    { tokenHash: hashToken(presented), revokedAt: { $exists: false } },
    { revokedAt: new Date(), revokedReason: reason },
  );
}

// Used on password reset — kills every live session for the account.
export async function revokeAllForUser(userId: string, reason: string): Promise<number> {
  const result = await RefreshTokenModel.updateMany(
    { userId: new Types.ObjectId(userId), revokedAt: { $exists: false } },
    { revokedAt: new Date(), revokedReason: reason },
  );
  return result.modifiedCount ?? 0;
}

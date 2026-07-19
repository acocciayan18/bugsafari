import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
  | { ok: true; tokens: IssuedTokens; userId: string }
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
    expiresIn: AUTH_CONFIG.ACCESS_TOKEN_TTL_MS,
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
  const record = await RefreshTokenModel.findOne({ tokenHash });
  if (!record) return { ok: false, reason: 'NOT_FOUND' };

  // Constant-time confirmation of the indexed match.
  const stored = Buffer.from(record.tokenHash, 'utf8');
  const computed = Buffer.from(tokenHash, 'utf8');
  if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  if (record.revokedAt) {
    console.error(`[AUTH] Refresh token reuse detected for user ${record.userId} — revoking family ${record.familyId}`);
    await revokeFamily(record.familyId, 'reuse-detected');
    return { ok: false, reason: 'REUSE_DETECTED' };
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await RefreshTokenModel.updateOne({ _id: record._id }, { revokedAt: new Date(), revokedReason: 'expired' });
    return { ok: false, reason: 'EXPIRED' };
  }

  const { UserModel } = await import('../../infrastructure/database/models/UserModel.js');
  const user = await UserModel.findById(record.userId).select('email');
  if (!user) {
    await revokeFamily(record.familyId, 'user-missing');
    return { ok: false, reason: 'REVOKED' };
  }

  await RefreshTokenModel.updateOne({ _id: record._id }, { revokedAt: new Date(), revokedReason: 'rotated' });
  const tokens = await mintPair(record.userId.toString(), user.email, record.familyId);
  return { ok: true, tokens, userId: record.userId.toString() };
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

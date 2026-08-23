/**
 * View-only share links — stateless, self-expiring JWTs bound to one session.
 *
 * Reuses the auth secret but a DISTINCT audience so a share token can never satisfy
 * requireAuth (which pins audience 'bugsafari-api') and an access token can never
 * satisfy a public share read. Nothing is persisted: the chosen lifetime lives in
 * the signed `exp` claim, and expiry — not revocation — is the access control.
 */

import jwt from 'jsonwebtoken';
import { AUTH_CONFIG } from './authConfig.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[shareToken]');

const SHARE_AUDIENCE = 'bugsafari-share';

// Owner-selectable link lifetimes. This list is also the server-side upper bound:
// only these exact values are honored, so no link outlives 30 days.
export const SHARE_TTL_PRESETS = ['1h', '24h', '7d', '30d'] as const;
export type ShareTtl = (typeof SHARE_TTL_PRESETS)[number];
export const DEFAULT_SHARE_TTL: ShareTtl = '7d';

// Narrow an untrusted body value to an allowed preset (the server-side allowlist).
export function isAllowedShareTtl(value: unknown): value is ShareTtl {
  return typeof value === 'string' && (SHARE_TTL_PRESETS as readonly string[]).includes(value);
}

// Mint a signed, self-expiring view-only token bound to one session id.
export function signShareToken(sessionId: string, ttl: ShareTtl): string {
  return jwt.sign({ sid: sessionId, purpose: 'share' }, AUTH_CONFIG.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: AUTH_CONFIG.JWT_ISSUER,
    audience: SHARE_AUDIENCE,
    expiresIn: ttl,
  });
}

// Verify a share token; returns the session id only for a valid, unexpired,
// share-purpose token. Expired / tampered / wrong-audience all resolve to null.
export function verifyShareToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, AUTH_CONFIG.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: AUTH_CONFIG.JWT_ISSUER,
      audience: SHARE_AUDIENCE,
      clockTolerance: 5,
    }) as Record<string, unknown>;
    if (decoded.purpose !== 'share' || typeof decoded.sid !== 'string' || !decoded.sid) {
      obsLog.warn('[shareToken] rejected: missing/invalid sid or purpose claim');
      return null;
    }
    return decoded.sid;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) obsLog.warn('[shareToken] rejected: link expired');
    else if (err instanceof jwt.JsonWebTokenError) obsLog.warn('[shareToken] rejected: invalid token', err.message);
    else obsLog.warn('[shareToken] rejected:', err instanceof Error ? err.message : 'unknown');
    return null;
  }
}

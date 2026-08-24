/**
 * LEGACY view-only share tokens — stateless, self-expiring JWTs bound to one session.
 *
 * Superseded by the persisted ShareLink model (snapshot + revoke). Retained for one
 * read path only: the public report endpoint falls back to verifying a JWT so links
 * minted before the migration keep resolving until they expire (≤30 days). Nothing
 * new is signed here anymore.
 */

import jwt from 'jsonwebtoken';
import { AUTH_CONFIG } from './authConfig.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[shareToken]');

const SHARE_AUDIENCE = 'bugsafari-share';

// Verify a legacy share token; returns the session id only for a valid, unexpired,
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

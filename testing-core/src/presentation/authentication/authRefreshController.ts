import type { Request, Response, NextFunction } from 'express';
import { rotateRefreshToken, revokeToken, type RotationFailure } from './refreshTokenService.js';

// A failed rotation always reads the same to the client — distinguishing "unknown
// token" from "replayed token" would tell an attacker which of their values landed.
const GENERIC_FAILURE = 'Session expired. Please log in again.';

function statusFor(reason: RotationFailure): number {
  return reason === 'MALFORMED' ? 400 : 401;
}

/**
 * POST /api/auth/refresh
 * Exchange a refresh token for a new access/refresh pair. The presented token is
 * revoked on use; replaying a revoked one burns the entire rotation family.
 */
export async function handleTokenRefresh(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const presented = (request.body as { refreshToken?: unknown } | undefined)?.refreshToken;
    const result = await rotateRefreshToken(presented);

    if (!result.ok) {
      console.warn(`[Auth] Refresh rejected: ${result.reason}`);
      response.status(statusFor(result.reason)).json({
        error: GENERIC_FAILURE,
        code: result.reason === 'REUSE_DETECTED' ? 'SESSION_REVOKED' : 'REFRESH_INVALID',
      });
      return;
    }

    // Rotation already loaded the user to sign the token — reuse its email
    // instead of a second identical lookup.
    console.log(`[Auth] Token rotated for user: ${result.email}`);
    response.json({
      ok: true,
      token: result.tokens.token,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn,
      user: { id: result.userId, email: result.email },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Revoke the presented refresh token. Always answers 200 so a stale or absent
 * token can't be probed for validity.
 */
export async function handleLogout(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await revokeToken((request.body as { refreshToken?: unknown } | undefined)?.refreshToken, 'logout');
    response.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

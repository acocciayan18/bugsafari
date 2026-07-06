import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AUTH_CONFIG, verifyTokenSync } from './authConfig.js';

/**
 * POST /api/auth/refresh
 * Refresh an existing JWT token - extends session without requiring password
 * Uses the existing token to verify user identity, issues new token with same expiration
 */
export async function handleTokenRefresh(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      response.status(401).json({
        error: 'Authentication required. Present valid token to refresh.',
      });
      return;
    }

    const oldToken = authHeader.substring(7);

    // Verify the existing token
    const decoded = verifyTokenSync(oldToken);
    if (!decoded) {
      response.status(401).json({
        error: 'Invalid or expired token. Please log in again.',
      });
      return;
    }

    // Generate new JWT token with same user info
    const newToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      AUTH_CONFIG.JWT_SECRET,
      { expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN } as jwt.SignOptions,
    );

    console.log(`[Auth] Token refreshed for user: ${decoded.email}`);

    response.json({
      ok: true,
      token: newToken,
      user: {
        id: decoded.userId,
        email: decoded.email,
      },
    });
  } catch (err) {
    console.error('[Auth] Token refresh error:', err);
    response.status(500).json({ error: 'Failed to refresh token' });
  }
}

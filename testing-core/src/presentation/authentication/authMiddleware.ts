import type { Request, Response, NextFunction } from 'express';
import { verifyTokenSync } from './authConfig.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  isGuest?: boolean;
}

/**
 * Middleware that requires authentication
 * Blocks non-authenticated users from accessing protected routes
 * 
 * FIX: Added detailed logging for authentication failures to help diagnose 401 issues
 */
export async function requireAuth(
  request: AuthRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    console.warn('[AUTH] requireAuth - rejected: missing Authorization header');
    response.status(401).json({
      error: 'Authentication required. Please log in to access this feature.',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH] requireAuth - rejected: malformed Authorization header (must start with "Bearer ")');
    response.status(401).json({
      error: 'Invalid authorization format. Expected "Bearer {token}".',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  const token = authHeader.substring(7);

  if (!token) {
    console.warn('[AUTH] requireAuth - rejected: empty token after Bearer prefix');
    response.status(401).json({
      error: 'Authentication required. Please log in to access this feature.',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  const decoded = verifyTokenSync(token);

  if (!decoded) {
    // FIX: Log more specific reason - will now be caught by verifyTokenSync logging
    console.warn('[AUTH] requireAuth - rejected: token verification failed');
    response.status(401).json({
      error: 'Invalid or expired token. Please log in again.',
    });
    return;
  }

  request.userId = decoded.userId;
  request.userEmail = decoded.email;
  request.isGuest = false;
  console.log('[AUTH] requireAuth - accepted for user:', decoded.email);
  next();
}

/**
 * Middleware that allows optional authentication
 * Extracts user info if token present, but allows guests to proceed
 */
export function optionalAuth(
  request: AuthRequest,
  _response: Response,
  next: NextFunction,
): void {
  const authHeader = request.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyTokenSync(token);

    if (decoded) {
      request.userId = decoded.userId;
      request.userEmail = decoded.email;
      request.isGuest = false;
    } else {
      request.isGuest = true;
    }
  } else {
    request.isGuest = true;
  }

  next();
}

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyTokenSync } from './authConfig.js';
import { maskEmail } from './authValidation.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[AUTH]');

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
    obsLog.warn('[AUTH] requireAuth - rejected: missing Authorization header');
    response.status(401).json({
      error: 'Authentication required. Please log in to access this feature.',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    obsLog.warn('[AUTH] requireAuth - rejected: malformed Authorization header (must start with "Bearer ")');
    response.status(401).json({
      error: 'Invalid authorization format. Expected "Bearer {token}".',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  const token = authHeader.substring(7);

  if (!token) {
    obsLog.warn('[AUTH] requireAuth - rejected: empty token after Bearer prefix');
    response.status(401).json({
      error: 'Authentication required. Please log in to access this feature.',
      code: 'GUEST_FORBIDDEN',
    });
    return;
  }

  const decoded = verifyTokenSync(token);

  if (!decoded) {
    // FIX: Log more specific reason - will now be caught by verifyTokenSync logging
    obsLog.warn('[AUTH] requireAuth - rejected: token verification failed');
    response.status(401).json({
      error: 'Invalid or expired token. Please log in again.',
    });
    return;
  }

  request.userId = decoded.userId;
  request.userEmail = decoded.email;
  request.isGuest = false;
  obsLog.info('[AUTH] requireAuth - accepted for user:', maskEmail(decoded.email));
  next();
}

/**
 * Middleware that allows optional authentication
 * Extracts user info if token present, but allows genuine guests to proceed.
 *
 * A present-but-invalid/expired Bearer token is NOT downgraded to guest: doing so
 * silently mis-attributes a real user's run to `guest` (session-isolation break) and
 * loses their run. It returns 401 TOKEN_EXPIRED so the client's refresh-and-retry
 * re-authenticates and keeps the real identity. Only a missing token means guest.
 */
export function optionalAuth(
  request: AuthRequest,
  response: Response,
  next: NextFunction,
): void {
  const authHeader = request.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = token ? verifyTokenSync(token) : null;

    if (decoded) {
      request.userId = decoded.userId;
      request.userEmail = decoded.email;
      request.isGuest = false;
      next();
      return;
    }

    obsLog.warn('[AUTH] optionalAuth - rejected: token present but invalid/expired');
    response.status(401).json({
      error: 'Invalid or expired token. Please log in again.',
      code: 'TOKEN_EXPIRED',
    });
    return;
  }

  request.isGuest = true;
  next();
}

// Run a middleware only for guests; authenticated requests pass straight through.
// Must be chained AFTER optionalAuth so request.isGuest is already resolved.
export function ifGuest(middleware: RequestHandler): RequestHandler {
  return function guestOnly(request: AuthRequest, response: Response, next: NextFunction): void {
    if (request.isGuest) {
      middleware(request, response, next);
      return;
    }
    next();
  };
}

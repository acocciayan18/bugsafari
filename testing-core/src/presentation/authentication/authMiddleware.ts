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
 */
export function requireAuth(
  request: AuthRequest,
  response: Response,
  next: NextFunction,
): void {
  const authHeader = request.headers.authorization;
  
  // DEBUG: Log all auth-related headers to diagnose token extraction issues
  console.log('[AUTH] requireAuth - Headers received:', {
    authorization: authHeader ? authHeader.substring(0, 30) + '...' : 'missing',
    cookie: request.headers.cookie ? 'present' : 'missing',
    referer: request.headers.referer,
    origin: request.headers.origin,
  });

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[AUTH] requireAuth - Missing or invalid Authorization header');
    response.status(401).json({
      error: 'Authentication required. Please log in to access this feature.',
    });
    return;
  }

  const token = authHeader.substring(7);
  console.log('[AUTH] requireAuth - Token received (first 20 chars):', token.substring(0, 20) + '...');
  
  const decoded = verifyTokenSync(token);
  
  if (!decoded) {
    console.log('[AUTH] requireAuth - Token verification failed');
    response.status(401).json({
      error: 'Invalid or expired token. Please log in again.',
    });
    return;
  }

  console.log('[AUTH] requireAuth - Token verified for userId:', decoded.userId, 'email:', decoded.email);
  request.userId = decoded.userId;
  request.userEmail = decoded.email;
  request.isGuest = false;
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

  // DEBUG: Log headers for optional auth as well
  console.log('[AUTH] optionalAuth - Headers received:', {
    authorization: authHeader ? authHeader.substring(0, 30) + '...' : 'missing',
    cookie: request.headers.cookie ? 'present' : 'missing',
  });

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    console.log('[AUTH] optionalAuth - Token received (first 20 chars):', token.substring(0, 20) + '...');
    const decoded = verifyTokenSync(token);

    if (decoded) {
      console.log('[AUTH] optionalAuth - Token verified for userId:', decoded.userId);
      request.userId = decoded.userId;
      request.userEmail = decoded.email;
      request.isGuest = false;
    } else {
      console.log('[AUTH] optionalAuth - Token invalid, treating as guest');
      request.isGuest = true;
    }
  } else {
    console.log('[AUTH] optionalAuth - No token, treating as guest');
    request.isGuest = true;
  }

  next();
}

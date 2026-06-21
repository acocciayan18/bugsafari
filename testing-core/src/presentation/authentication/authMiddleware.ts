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

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    response.status(401).json({
      error: 'Authentication required. Please log in to access this feature.',
    });
    return;
  }

  const token = authHeader.substring(7);
  const decoded = verifyTokenSync(token);

  if (!decoded) {
    response.status(401).json({
      error: 'Invalid or expired token. Please log in again.',
    });
    return;
  }

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

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'bugsafari-dev-secret-change-in-production';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  isGuest?: boolean;
}

/**
 * Verify JWT token and extract user info
 */
export function verifyToken(token: string): { userId: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    return decoded;
  } catch {
    return null;
  }
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
  const decoded = verifyToken(token);

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
    const decoded = verifyToken(token);

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

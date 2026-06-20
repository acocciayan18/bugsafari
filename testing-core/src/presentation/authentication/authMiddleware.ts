import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// SECURITY: Enforce JWT_SECRET environment variable (must match authController.ts)
let JWT_SECRET = process.env.JWT_SECRET as string;
// Fallback for development mode only (never use in production)
if (!JWT_SECRET) {
  console.warn('[WARNING] JWT_SECRET not set, using development fallback. Set JWT_SECRET in production!');
  JWT_SECRET = 'bugsafari-dev-secret-fallback-32charsminimum!';
}
// Validate secret strength in production (skip for dev fallback)
if (!JWT_SECRET.includes('fallback') && JWT_SECRET.length < 32) {
  throw new Error('FATAL: JWT_SECRET must be at least 32 characters for secure signing.');
}
// Type assertion: After validation, JWT_SECRET is guaranteed to be defined
const JWT_SECRET_STR: string = JWT_SECRET;

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
    const decoded = jwt.verify(token, JWT_SECRET_STR) as {
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

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
export async function requireAuth(
  request: AuthRequest,
  response: Response,
  next: NextFunction,
): Promise<void> {
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
  
  // CRITICAL DEBUG: Log the JWT_SECRET being used for verification
  const { AUTH_CONFIG } = await import('./authConfig.js');
  console.log('[AUTH] JWT_SECRET being used for verify:', AUTH_CONFIG.JWT_SECRET);
  console.log('[AUTH] JWT_SECRET length:', AUTH_CONFIG.JWT_SECRET?.length);
  
  // Decode first to see the token's claims without verification
  const jwt = await import('jsonwebtoken');
  const decodedNoVerify = jwt.default.decode(token);
  console.log('[AUTH] Token decoded (no verify - claims):', JSON.stringify(decodedNoVerify));
  
  // Use existing verifyTokenSync but with better error logging
  let decoded;
  try {
    decoded = verifyTokenSync(token);
  } catch (err: any) {
    // Log the actual error from jwt.verify
    console.error('[AUTH] requireAuth - verifyTokenSync threw:', err.message || String(err));
  }
  
  if (!decoded) {
    // Manual verify with detailed error capture - capture exact error
    let verificationError = 'UNKNOWN';
    try {
      const verified = jwt.default.verify(token, AUTH_CONFIG.JWT_SECRET);
      console.log('[AUTH] Manual verify succeeded:', verified);
      decoded = verified as any;
    } catch (verifyErr: any) {
      verificationError = verifyErr.message || String(verifyErr);
      console.error('[AUTH] Manual verify FAILED with error:', verificationError);
      console.error('[AUTH] This likely means JWT_SECRET mismatch or token was signed with different secret');
    }
    
    if (!decoded) {
      console.log('[AUTH] requireAuth - Token verification failed. Error:', verificationError);
      // Type guard: ensure decodedNoVerify is an object with exp/iat properties before accessing
      if (decodedNoVerify && typeof decodedNoVerify === 'object' && 'exp' in decodedNoVerify && 'iat' in decodedNoVerify) {
        console.log('[AUTH] Token exp:', (decodedNoVerify as any).exp, 'Current time:', Math.floor(Date.now()/1000));
        console.log('[AUTH] Token iat:', (decodedNoVerify as any).iat);
      } else {
        console.log('[AUTH] Token could not be decoded or missing standard JWT claims');
      }
      response.status(401).json({
        error: 'Invalid or expired token. Please log in again.',
      });
      return;
    }
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

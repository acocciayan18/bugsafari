/**
 * Shared authentication configuration
 * Eliminates duplicate JWT_SECRET logic across auth files
 *
 * SECURITY: Production requires JWT_SECRET to be set via environment variable.
 * Development mode automatically uses a secure fallback when not configured.
 */

import jwt from 'jsonwebtoken';

// Determine environment mode
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development' || !isProduction;

// The hardcoded local-dev secret. Named so it can be checked for by exact
// value below, not just guessed at via substring heuristics.
const DEV_FALLBACK_SECRET = 'bugsafari-local-development-secret';

// Use type assertion for env var
let JWT_SECRET = process.env.JWT_SECRET as string | undefined;

// Initialize with early validation
if (!JWT_SECRET) {
  if (isProduction) {
    // PRODUCTION: JWT_SECRET is mandatory - fail hard
    throw new Error(
      'FATAL: JWT_SECRET environment variable is required in production. ' +
      'Set JWT_SECRET to a secure random string of at least 32 characters.'
    );
  }
  // DEVELOPMENT: Use consistent secret that matches docker-compose.local.yml
  // IMPORTANT: This MUST match JWT_SECRET in docker-compose.local.yml, root .env, and testing-core/.env
  // to avoid cross-context token verification (401) failures.
  JWT_SECRET = DEV_FALLBACK_SECRET;
  console.warn(
    `[authConfig] JWT_SECRET env var not set — using development fallback "${JWT_SECRET}". ` +
    'If tokens minted elsewhere 401 here, the launch context is using a different secret.',
  );
}

// PRODUCTION VALIDATION: the dev fallback must never be used in production,
// even if an operator explicitly sets JWT_SECRET to that exact value (e.g. by
// copying a dev .env file) — the substring/length checks below wouldn't catch
// this since the fallback string is 34 chars and doesn't contain "fallback".
if (isProduction && JWT_SECRET === DEV_FALLBACK_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET is set to the hardcoded development fallback value in production. ' +
    'Set JWT_SECRET to a unique, secure random string of at least 32 characters.'
  );
}

// PRODUCTION VALIDATION: Enforce 32+ character secret
if (isProduction && JWT_SECRET.length < 32) {
  throw new Error(
    `FATAL: JWT_SECRET must be at least 32 characters. Current length: ${JWT_SECRET.length}`
  );
}

// Validate secret does not contain obvious dev markers in production
if (isProduction && JWT_SECRET.includes('dev') && JWT_SECRET.includes('fallback')) {
  throw new Error(
    'FATAL: JWT_SECRET appears to contain development fallback markers. ' +
    'Use a production-grade secret.'
  );
}

// Access tokens are short-lived because they are stateless and cannot be revoked;
// durability of a session comes from the rotating refresh token instead.
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN ?? '30m';
const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = Number(process.env.REFRESH_TOKEN_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);

// Configuration object - immutable in production
// JWT_SECRET is guaranteed to be defined after validation - use non-null assertion
export const AUTH_CONFIG = {
  JWT_SECRET: JWT_SECRET!, // Non-null assertion: validated above
  ACCESS_TOKEN_TTL,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  isProduction,
  isDevelopment,
} as const;

// Reusable authentication payload type
export type AuthPayload = {
  userId: string;
  email: string;
};

// Full JWT payload including issued/expiry timestamps
export type DecodedJWTPayload = AuthPayload & {
  iat: number;
  exp: number;
};

// Helper to check if running in production
export function isProductionMode(): boolean {
  return isProduction;
}

// Helper to get environment-aware configuration
export function getAuthConfig() {
  return AUTH_CONFIG;
}

/**
 * Verify JWT token and extract user info — async wrapper kept for backward compat.
 */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  return verifyTokenSync(token);
}

/**
 * Synchronous JWT token verification — used by Express middleware.
 * Uses the statically imported jwt module (ESM-safe, no require()).
 * 
 * FIX: Added detailed logging to diagnose 401 failures.
 * Logs whether verification failed due to expired token vs. invalid signature
 */
export function verifyTokenSync(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, AUTH_CONFIG.JWT_SECRET) as Record<string, unknown>;
    // A validly-signed token missing string userId/email must fail cleanly here,
    // not blow up downstream in `new Types.ObjectId(undefined)`.
    if (typeof decoded.userId !== 'string' || typeof decoded.email !== 'string') {
      console.warn('[AUTH] Token verification failed: userId/email claim missing or non-string');
      return null;
    }
    return { userId: decoded.userId, email: decoded.email };
  } catch (err) {
    // FIX: Log specific reason for verification failure to help diagnose 401 issues
    if (err instanceof jwt.TokenExpiredError) {
      console.warn('[AUTH] Token verification failed: Token has expired');
    } else if (err instanceof jwt.JsonWebTokenError) {
      console.warn('[AUTH] Token verification failed: Invalid token', err.message);
    } else {
      console.warn('[AUTH] Token verification failed:', err instanceof Error ? err.message : 'Unknown error');
    }
    return null;
  }
}

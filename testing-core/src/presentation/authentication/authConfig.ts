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
  // IMPORTANT: This MUST match JWT_SECRET in docker-compose.local.yml to avoid token verification failures
  console.warn('[WARNING] JWT_SECRET not set. Using development fallback (must match docker-compose).');
  JWT_SECRET = 'bugsafari-local-development-secret';
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

// Configuration object - immutable in production
// JWT_SECRET is guaranteed to be defined after validation - use non-null assertion
export const AUTH_CONFIG = {
  JWT_SECRET: JWT_SECRET!, // Non-null assertion: validated above
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',
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
 */
export function verifyTokenSync(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, AUTH_CONFIG.JWT_SECRET) as unknown as AuthPayload;
    return decoded;
  } catch {
    return null;
  }
}

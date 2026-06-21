/**
 * Shared authentication configuration
 * Eliminates duplicate JWT_SECRET logic across auth files
 * 
 * SECURITY: Production requires JWT_SECRET to be set via environment variable.
 * Development mode automatically uses a secure fallback when not configured.
 */

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
  // DEVELOPMENT: Use secure fallback with explicit dev marker
  console.warn('[WARNING] JWT_SECRET not set. Using development fallback (DO NOT USE IN PRODUCTION).');
  JWT_SECRET = 'dev-only-bugsafari-fallback-key-32ch-min!';
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
 * Verify JWT token and extract user info - centralized for reuse
 * Uses dynamic import to avoid issues with ESM/CommonJS
 */
export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    // Dynamic import to handle jsonwebtoken
    const jwt = await import('jsonwebtoken');
    // Use AUTH_CONFIG.JWT_SECRET which has the non-null assertion applied
    const secret = AUTH_CONFIG.JWT_SECRET;
    // Cast through unknown first to satisfy TypeScript type checking
    const decoded = jwt.default.verify(token, secret) as unknown as AuthPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Synchronous JWT token verification - for use in Express middleware
 * Uses synchronous jsonwebtoken.verify for non-async contexts
 */
export function verifyTokenSync(token: string): AuthPayload | null {
  try {
    // Import jsonwebtoken synchronously (ESM default export)
    const jwt = require('jsonwebtoken');
    // Use AUTH_CONFIG.JWT_SECRET which has the non-null assertion applied
    const secret = AUTH_CONFIG.JWT_SECRET;
    // Cast through unknown first to satisfy TypeScript type checking
    const decoded = jwt.verify(token, secret) as unknown as AuthPayload;
    return decoded;
  } catch {
    return null;
  }
}

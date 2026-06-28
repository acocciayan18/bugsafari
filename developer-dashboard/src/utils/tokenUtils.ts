// ============================================================================
// tokenUtils - Pure JWT parsing helpers
// ============================================================================
// Extracted from AuthContext so raw token operations live outside the provider
// wrapper. No React/runtime dependencies — safe to unit test in isolation.

/**
 * Decode the JWT payload to read its expiration claim. Returns null when the
 * token is malformed or unparseable (never throws).
 */
export function decodeTokenExpiration(token: string): { exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

/**
 * True when the token is missing an `exp` claim or sits within the 2-minute
 * refresh buffer. The buffer prevents unnecessary refresh attempts while the
 * token still has meaningful remaining time.
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeTokenExpiration(token);
  if (!payload || !payload.exp) {
    console.log('[tokenUtils] Invalid token payload (no exp claim)');
    return true;
  }
  // FIX: Increased buffer from 30 seconds to 120 seconds (2 minutes)
  // This prevents unnecessary token refresh attempts when token still has valid remaining time
  const timeRemainingMs = (payload.exp * 1000) - Date.now();
  const isExpired = timeRemainingMs < 120000; // 2 minute buffer
  if (isExpired) {
    console.log(`[tokenUtils] Token expired or near expiry. Time remaining: ${Math.round(timeRemainingMs/1000)}s`);
  } else {
    console.log(`[tokenUtils] Token valid. Time remaining: ${Math.round(timeRemainingMs/1000)}s`);
  }
  return isExpired;
}

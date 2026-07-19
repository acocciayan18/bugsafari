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

const DEFAULT_BUFFER_SECONDS = 120;

/**
 * True when the token is missing an `exp` claim or falls within `bufferSeconds`
 * of expiry. The buffer prevents a request from racing the expiry boundary; pass
 * a larger value to drive proactive renewal ahead of time.
 */
export function isTokenExpired(token: string, bufferSeconds: number = DEFAULT_BUFFER_SECONDS): boolean {
  const payload = decodeTokenExpiration(token);
  if (!payload || !payload.exp) return true;
  return (payload.exp * 1000) - Date.now() < bufferSeconds * 1000;
}

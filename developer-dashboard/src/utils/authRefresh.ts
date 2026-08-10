// ============================================================================
// authRefresh - Framework-agnostic silent token refresh
// ============================================================================
// Shared by AuthContext (hook-based) and plain modules that can't use hooks
// (historyService, EngineHttpClient), so a 401 in any of them can attempt one
// silent refresh before falling back to session-expired/logout.

import { apiUrl } from './apiBase';

export interface RefreshedAuth {
  token: string;
  user: { id: string; email: string };
}

const TOKEN_REFRESHED_EVENT = 'bugsafari:token-refreshed';
export const SESSION_REVOKED_EVENT = 'bugsafari:session-revoked';

export const TOKEN_KEY = 'bugsafari_token';
export const USER_KEY = 'bugsafari_user';
// Non-sensitive presence hint. The refresh token now lives in an httpOnly cookie
// JS cannot read, so this flag is how boot logic knows a refresh is worth attempting
// instead of a pointless 401 on every guest/logged-out load. Lifecycle mirrors the cookie.
export const SESSION_FLAG_KEY = 'bugsafari_session';

export function hasStoredSession(): boolean {
  return localStorage.getItem(SESSION_FLAG_KEY) === '1';
}

export function persistSession(token: string, user: RefreshedAuth['user']): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(SESSION_FLAG_KEY, '1');
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_FLAG_KEY);
}

// Storage is attacker-writable — a tampered/corrupt user must never reach React
// state, where a non-string email crashes the first render that indexes it.
export function parseStoredUser(raw: string | null): RefreshedAuth['user'] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v && typeof v.id === 'string' && typeof v.email === 'string') return { id: v.id, email: v.email };
  } catch { /* corrupt payload */ }
  return null;
}

// Concurrent 401s must not each burn a rotation — the server revokes the whole
// family when a already-rotated token is replayed. All callers share one flight.
let inFlight: Promise<RefreshedAuth | null> | null = null;

/**
 * Exchange the stored refresh token for a new access/refresh pair, persist the
 * result, and broadcast it so AuthContext stays in sync even when the refresh
 * was triggered from a non-hook module. Returns null on any failure.
 *
 * The access token argument is ignored — rotation is driven entirely by the
 * refresh token — but the signature is kept so existing call sites still work.
 */
export async function refreshAuthToken(_currentToken?: string | null): Promise<RefreshedAuth | null> {
  if (inFlight) return inFlight;

  // No JS-readable refresh token to gate on anymore — the httpOnly cookie carries it.
  // A load with no prior session skips the round-trip via the presence flag.
  if (!hasStoredSession()) return null;

  inFlight = (async () => {
    try {
      // credentials:'include' so the httpOnly refresh cookie rides along; the body
      // is empty because the token is never in JS reach.
      const response = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string } | null;
        // The server burned this token family (replay detected) or the token is
        // simply dead — either way the stored session is unusable.
        clearSession();
        window.dispatchEvent(new CustomEvent(SESSION_REVOKED_EVENT, {
          detail: { reason: body?.code ?? 'REFRESH_INVALID' },
        }));
        return null;
      }

      const data = await response.json() as {
        token?: string;
        user?: { id: string; email: string };
      };
      if (!data.token || !data.user) return null;

      persistSession(data.token, data.user);

      const detail: RefreshedAuth = { token: data.token, user: data.user };
      window.dispatchEvent(new CustomEvent<RefreshedAuth>(TOKEN_REFRESHED_EVENT, { detail }));
      return detail;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Subscribe to refreshes triggered anywhere in the app. Returns an unsubscribe function. */
export function onTokenRefreshed(handler: (auth: RefreshedAuth) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<RefreshedAuth>).detail);
  window.addEventListener(TOKEN_REFRESHED_EVENT, listener);
  return () => window.removeEventListener(TOKEN_REFRESHED_EVENT, listener);
}

/** Subscribe to hard session termination (refresh rejected / family revoked). */
export function onSessionRevoked(handler: (reason: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<{ reason: string }>).detail.reason);
  window.addEventListener(SESSION_REVOKED_EVENT, listener);
  return () => window.removeEventListener(SESSION_REVOKED_EVENT, listener);
}

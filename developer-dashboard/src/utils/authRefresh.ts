// ============================================================================
// authRefresh - Framework-agnostic silent token refresh
// ============================================================================
// Shared by AuthContext (hook-based) and plain modules that can't use hooks
// (historyService, EngineHttpClient), so a 401 in any of them can attempt one
// silent refresh before falling back to session-expired/logout.

export interface RefreshedAuth {
  token: string;
  user: { id: string; email: string };
}

const TOKEN_REFRESHED_EVENT = 'bugsafari:token-refreshed';
export const SESSION_REVOKED_EVENT = 'bugsafari:session-revoked';

export const TOKEN_KEY = 'bugsafari_token';
export const REFRESH_KEY = 'bugsafari_refresh';
export const USER_KEY = 'bugsafari_user';

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function persistSession(token: string, refreshToken: string, user: RefreshedAuth['user']): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
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

  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  inFlight = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
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
        refreshToken?: string;
        user?: { id: string; email: string };
      };
      if (!data.token || !data.refreshToken || !data.user) return null;

      persistSession(data.token, data.refreshToken, data.user);

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

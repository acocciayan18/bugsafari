// ============================================================================
// authRefresh - Framework-agnostic silent token refresh
// ============================================================================
// Shared by AuthContext (hook-based) and plain modules that can't use hooks
// (historyService, EngineHttpClient), so a 401 in any of them can attempt one
// silent refresh before falling back to session-expired/logout.

import { buildAuthHeaders } from './authHeaders';

export interface RefreshedAuth {
  token: string;
  user: { id: string; email: string };
}

const TOKEN_REFRESHED_EVENT = 'bugsafari:token-refreshed';

/**
 * Calls /api/auth/refresh with the given token, persists the result, and
 * broadcasts it so AuthContext (if mounted) stays in sync even when the
 * refresh was triggered from a non-hook module. Returns null on any failure.
 *
 * NOTE: the backend re-verifies `currentToken` to mint the new one, so this
 * only succeeds while the current token hasn't already passed its real JWT
 * expiry - it cannot resurrect a session after a hard expiry.
 */
export async function refreshAuthToken(currentToken: string | null | undefined): Promise<RefreshedAuth | null> {
  if (!currentToken) return null;

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: buildAuthHeaders(currentToken),
    });
    if (!response.ok) return null;

    const data = await response.json() as { token?: string; user?: { id: string; email: string } };
    if (!data.token || !data.user) return null;

    localStorage.setItem('bugsafari_token', data.token);
    localStorage.setItem('bugsafari_user', JSON.stringify(data.user));

    const detail: RefreshedAuth = { token: data.token, user: data.user };
    window.dispatchEvent(new CustomEvent<RefreshedAuth>(TOKEN_REFRESHED_EVENT, { detail }));
    return detail;
  } catch {
    return null;
  }
}

/** Subscribe to refreshes triggered anywhere in the app. Returns an unsubscribe function. */
export function onTokenRefreshed(handler: (auth: RefreshedAuth) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<RefreshedAuth>).detail);
  window.addEventListener(TOKEN_REFRESHED_EVENT, listener);
  return () => window.removeEventListener(TOKEN_REFRESHED_EVENT, listener);
}

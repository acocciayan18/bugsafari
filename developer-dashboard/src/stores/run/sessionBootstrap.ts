// Preconditions for the startup requests, kept dependency-free so they can be
// reasoned about (and tested) without loading the store or the socket client.

/** Auth state the session bootstrap needs, resolved before any request goes out. */
export interface SessionBootstrap {
    /** Access token for protected calls; null for a guest. */
    authToken: string | null;
    /** True only when a token AND a restored user are both present. */
    isAuthenticated: boolean;
}

/**
 * Session history is an authenticated-only resource (`requireAuth`, with a guest
 * rejection behind it). Requesting it as a guest — or while a stored token's user
 * is still being restored — is a 401 by construction, which is exactly what
 * startup was doing.
 */
export function shouldFetchHistory(bootstrap: SessionBootstrap): boolean {
    return bootstrap.isAuthenticated && bootstrap.authToken !== null;
}

/**
 * Is there anything to restore? A run is claimed either by possession of a stored
 * run token or by an authenticated identity. With neither, the restore probe can
 * only answer "no snapshot" — a redundant request on every load.
 */
export function shouldRestoreSession(bootstrap: SessionBootstrap, storedRunId: string | null): boolean {
    return storedRunId !== null || bootstrap.isAuthenticated;
}

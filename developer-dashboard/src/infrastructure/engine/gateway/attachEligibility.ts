// Ownership rules for a SESSION_ATTACH emit. Dependency-free on purpose: the
// socket manager and its tests both read from here, and nothing else should have
// to load socket.io to reason about whether attaching is even possible.

/** The one place the stored access token is read, so the socket handshake and
 *  the attach-eligibility check can never disagree about the identity. */
export function storedAuthToken(): string | null {
  try {
    return localStorage.getItem('bugsafari_token');
  } catch {
    return null; // Storage unavailable / blocked
  }
}

/**
 * Can this socket possibly be attached to a run? The backend proves ownership
 * two ways: possession of the run token, or an identity match on an
 * authenticated run. With neither, SESSION_ATTACH can only ever answer
 * `no-active-session` — so emitting it is a guaranteed-useless round-trip, and
 * doing it on every connect and reconnect is what filled the console with
 * "Attach rejected" warnings on an ordinary page load.
 */
export function canAttach(runToken: string | null, authToken: string | null): boolean {
  return Boolean(runToken) || Boolean(authToken);
}

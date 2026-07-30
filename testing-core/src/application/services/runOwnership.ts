// The one rule deciding whether a requester owns a run. Dependency-free on
// purpose: SessionManager and its tests both read from here, so nothing has to
// load socket.io to reason about ownership.

/** Identity of a run, live or retained-terminal. */
export interface RunOwner {
  runToken: string;
  /** Null for a guest run — no identity exists to match against. */
  userId: string | null;
}

/**
 * An AUTHENTICATED run requires an identity match. Possession of the run token is
 * not sufficient: a token outlives its run in the client's localStorage, and a
 * second account logging into the same browser would otherwise replay the first
 * account's telemetry and findings.
 *
 * A GUEST run has no identity to check, so possession of the unguessable
 * server-issued token remains the only available proof — that is what lets a
 * refreshed guest tab recover its own run.
 */
export function ownsRun(run: RunOwner, presentedToken: string | undefined, userId: string | null): boolean {
  const hasToken = typeof presentedToken === 'string' && presentedToken === run.runToken;
  if (run.userId === null) return hasToken;
  return userId !== null && userId === run.userId;
}

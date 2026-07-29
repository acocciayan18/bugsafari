// ═══════════════════════════════════════════════════════════════
// shared/types/auth.ts — TARGET-APPLICATION AUTHENTICATION
// ═══════════════════════════════════════════════════════════════
// Credentials for the application UNDER TEST — unrelated to BugSafari's own
// operator accounts (see presentation/authentication).
//
// INVARIANT: ephemeral, and never stored in plaintext. These values live in
// memory for the duration of one run and are never written to MongoDB, logs,
// reports, telemetry, or a BullMQ job payload (which Redis retains for 24h on
// failure). Anything that persists or broadcasts a run config must exclude them.
//
// The ONE permitted crossing of a process boundary is the AuthVault
// (testing-core/src/infrastructure/queue/AuthVault.ts): AES-256-GCM sealed under
// BUGSAFARI_AUTH_KEY, keyed by runId, 10-minute TTL, destroyed on first read.
// That is what makes an authenticated run safe to queue; the job payload itself
// carries only a `hasAuth` marker.
/** Parse + structurally validate a serialized storageState. Returns null when unusable. */
export function parseStorageState(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const { cookies, origins } = parsed;
        if (!Array.isArray(cookies) || !Array.isArray(origins))
            return null;
        if (cookies.length === 0 && origins.length === 0)
            return null;
        return { cookies, origins };
    }
    catch {
        return null;
    }
}

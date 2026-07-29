// ═══════════════════════════════════════════════════════════════
// shared/types/forensicLogs.ts - FULL NETWORK & CONSOLE LOG CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Persisted per-run logs mirroring the live dashboard tabs. Unlike
// forensic_errors (faults only), these capture EVERY request/console
// line so a saved report matches what the operator watched live.
// A network row is actionable only when it signals a defect: a transport-level
// failure (no status — DNS/offline/refused/timeout/CORS) or an HTTP error (>=400).
// 2xx/3xx successes are noise — never emitted live, persisted, or rendered. Both
// packages share this one predicate so live and saved outputs stay identical.
export function isActionableNetworkStatus(statusCode) {
    return statusCode === undefined || statusCode === null || statusCode >= 400;
}

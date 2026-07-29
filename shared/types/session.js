// ═══════════════════════════════════════════════════════════════
// shared/types/session.ts - SESSION RECOVERY & RECONNECTION CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Cross-package contracts for surviving refreshes, network blips, and
// WebSocket drops without losing the active exploration run.
// ── Socket event names (shared so client/server can never drift) ──────────────
export const SESSION_ATTACH_EVENT = 'session-attach';
export const SESSION_SNAPSHOT_EVENT = 'session-snapshot';
export const TIME_SYNC_EVENT = 'time-sync';

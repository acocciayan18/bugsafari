// ═══════════════════════════════════════════════════════════════
// shared/types/queue.ts - REDIS EXECUTION QUEUE CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Client/server contract for the BullMQ-backed run queue: how a client
// subscribes to its enqueued job and the live status pushes it receives.
// ── Socket event names (shared so client/server can never drift) ──────────────
export const QUEUE_SUBSCRIBE_EVENT = 'queue-subscribe';
export const QUEUE_UPDATE_EVENT = 'queue-update';

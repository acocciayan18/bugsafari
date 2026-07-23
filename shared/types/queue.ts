// ═══════════════════════════════════════════════════════════════
// shared/types/queue.ts - REDIS EXECUTION QUEUE CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Client/server contract for the BullMQ-backed run queue: how a client
// subscribes to its enqueued job and the live status pushes it receives.

// ── Socket event names (shared so client/server can never drift) ──────────────
export const QUEUE_SUBSCRIBE_EVENT = 'queue-subscribe' as const;
export const QUEUE_UPDATE_EVENT = 'queue-update' as const;

/** Lifecycle of a queued Safari job as surfaced to the dashboard. */
export type QueueJobState = 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled';

/** Client → server: join the update stream for an enqueued job + its future run room. */
export interface QueueSubscribeRequest {
  jobId: string;
  /** Opaque bearer token for the future run room (was runId). */
  runToken?: string;
}

/** Server → client: a queue position / lifecycle push for one job. */
export interface QueueUpdate {
  jobId: string;
  state: QueueJobState;
  position: number | null; // 1-based place among waiting jobs; null once not waiting
  queueDepth: number;       // total jobs still waiting
  activeCount: number;      // jobs currently executing on the fleet
  message?: string;         // failure reason or human-facing note
}

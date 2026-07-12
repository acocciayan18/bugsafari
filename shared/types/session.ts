// ═══════════════════════════════════════════════════════════════
// shared/types/session.ts - SESSION RECOVERY & RECONNECTION CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Cross-package contracts for surviving refreshes, network blips, and
// WebSocket drops without losing the active exploration run.

import type { TelemetryEvent } from './telemetry.js';
import type { ForensicCrashReport, IncidentReport } from './bug.js';

/** Live lifecycle of the single active run — superset of the DB SessionStatus. */
export type RunLifecycleStatus =
  | 'IDLE'          // no active run
  | 'RUNNING'       // engine executing, owner attached
  | 'PAUSED'        // paused by operator
  | 'INTERRUPTED'   // owner dropped; engine alive inside grace window
  | 'DISCONNECTED'  // grace expired; engine being torn down
  | 'COMPLETED'     // finished normally
  | 'CRASHED'       // finished via fatal engine error
  | 'CRASH_COMPLETED'; // target server crash confirmed by health probe; run terminated

/** Whether the active run belongs to an authenticated operator or a guest. */
export type SessionOwnerType = 'authenticated' | 'guest';

// ── Socket event names (shared so client/server can never drift) ──────────────
export const SESSION_ATTACH_EVENT = 'session-attach' as const;
export const SESSION_SNAPSHOT_EVENT = 'session-snapshot' as const;

/** Everything a returning client needs to rebuild the live dashboard verbatim. */
export interface ActiveSessionSnapshot {
  runId: string;
  ownerType: SessionOwnerType;
  targetUrl: string;
  currentUrl: string;
  status: RunLifecycleStatus;
  startedAt: string;
  elapsedTimeMs: number;
  timeboxMs: number;
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  /** Latest base64 JPEG frame (no data: prefix); only the newest is retained. */
  lastFrame: string | null;
}

/** Client → server attach request presented on every (re)connection. */
export interface SessionAttachRequest {
  runId?: string;
}

/** Server → client attach acknowledgement carrying the replay bundle when owned. */
export interface SessionAttachAck {
  attached: boolean;
  reason?: string;
  snapshot?: ActiveSessionSnapshot;
}

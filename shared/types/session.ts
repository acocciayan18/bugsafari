// ═══════════════════════════════════════════════════════════════
// shared/types/session.ts - SESSION RECOVERY & RECONNECTION CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Cross-package contracts for surviving refreshes, network blips, and
// WebSocket drops without losing the active exploration run.

import type { AccessibilityFinding, TelemetryEvent } from './telemetry.js';
import type { ForensicCrashReport, IncidentReport } from './bug.js';
import type { BrowserConsoleMessage } from './console.js';
import type { RunTerminationOutcome } from './termination.js';

/** Live lifecycle of the single active run — superset of the DB SessionStatus. */
export type RunLifecycleStatus =
  | 'IDLE'          // no active run
  | 'QUEUED'        // job waiting in the distributed queue; no engine yet
  | 'STARTING'      // room reserved, engine booting; owner may attach already
  | 'RUNNING'       // engine executing, owner attached
  | 'PAUSING'       // pause requested; awaiting in-flight tasks to settle (transient)
  | 'PAUSED'        // paused by operator
  | 'STOPPING'      // stop requested; flushing pending writes before teardown (transient)
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
export const TIME_SYNC_EVENT = 'time-sync' as const;

/** Authoritative timebox clock streamed by the engine (~1 Hz). The frontend timer
 *  is a display slaved to this; it never runs an independent countdown. `elapsedActiveMs`
 *  excludes paused time. Bypasses the capped telemetry buffer. */
export interface TimeSyncPayload {
  elapsedActiveMs: number;
  timeboxMs: number;
}

/** Everything a returning client needs to rebuild the live dashboard verbatim. */
export interface ActiveSessionSnapshot {
  /** Public, human-readable session code (RUN-XXXXXX) shown to the operator. */
  runId: string;
  /** Opaque high-entropy bearer token used to (re)attach + prove ownership. */
  runToken: string;
  ownerType: SessionOwnerType;
  targetUrl: string;
  currentUrl: string;
  status: RunLifecycleStatus;
  /** Why a terminal run ended. Null while live. Authoritative for restore — the
   *  telemetry replay buffer is capped and can evict the terminal event. */
  terminationOutcome: RunTerminationOutcome | null;
  /** Engine-supplied detail behind {@link terminationOutcome}. */
  terminationReason: string | null;
  startedAt: string;
  elapsedTimeMs: number;
  timeboxMs: number;
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  /** WCAG findings replayed on the dedicated accessibility channel. */
  accessibility: AccessibilityFinding[];
  /** Recent target-page console/pageerror rows, so a reconnect restores the Console tab. */
  browserConsole: BrowserConsoleMessage[];
  /** Latest base64 JPEG frame (no data: prefix); only the newest is retained. */
  lastFrame: string | null;
  /** Distributed-queue context (BUGSAFARI_USE_QUEUE only) — lets a restored client re-subscribe to its job. */
  jobId?: string | null;
  queuePosition?: number | null;
  queueDepth?: number;
  /** Fleet occupancy at restore time, so a refreshed queued client shows the same
   *  standby detail as a client that stayed subscribed to QUEUE_UPDATE. */
  queueActiveCount?: number;
  queueWorkerCount?: number | null;
}

/** Client → server attach request presented on every (re)connection. */
export interface SessionAttachRequest {
  /** Opaque bearer token from the last snapshot; proves ownership on reattach. */
  runToken?: string;
}

/** Server → client attach acknowledgement carrying the replay bundle when owned. */
export interface SessionAttachAck {
  attached: boolean;
  reason?: string;
  snapshot?: ActiveSessionSnapshot;
}

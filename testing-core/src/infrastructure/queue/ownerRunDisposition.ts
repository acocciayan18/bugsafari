import { isEngineStale } from '../../application/services/runHealth.js';
import type { RunRegistryEntry } from './RunRegistry.js';

// BullMQ states meaning "still waiting for a worker" — a run in any of these is live.
export const WAITING_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children']);

// Minimal registry/queue surfaces this needs — keeps the classifier unit-testable
// with fakes (the concrete RunRegistry/TaskQueue satisfy these structurally).
export interface OwnerRunRegistry {
  findByRunToken(runToken: string): Promise<RunRegistryEntry | null>;
  findByOwner(userId: string): Promise<RunRegistryEntry | null>;
  readHeartbeatAgeMs(runToken: string): Promise<number | null>;
}

export interface OwnerRunQueue {
  getJobState(jobId: string): Promise<string>;
}

// How a requester's own existing run relates to a fresh launch request.
// none      no run owned — start clean.
// resumable live and NOT stop-requested — reconnect instead of duplicating.
// draining  operator already stopped it, worker still tearing down — defer the launch.
// clearable terminal, vanished, or a ghost (stale heartbeat) — drop it and start fresh.
export type OwnerRunDisposition = 'none' | 'resumable' | 'draining' | 'clearable';

export interface OwnerRunClassification {
  entry: RunRegistryEntry | null;
  jobState: string;
  disposition: OwnerRunDisposition;
}

// Classify the requester's current run at admission time. Centralizes the state machine
// the start-test guard and /api/session/active both derived ad hoc.
export async function classifyOwnerRun(
  runRegistry: OwnerRunRegistry,
  taskQueue: OwnerRunQueue,
  opts: { userId: string | null; runToken?: string | null },
): Promise<OwnerRunClassification> {
  const { userId, runToken } = opts;
  const entry = runToken
    ? await runRegistry.findByRunToken(runToken)
    : (userId ? await runRegistry.findByOwner(userId) : null);
  // No entry, or one owned by another authenticated user, is not this requester's run.
  if (!entry || (entry.userId && entry.userId !== (userId ?? null))) {
    return { entry: null, jobState: 'none', disposition: 'none' };
  }

  const jobState = await taskQueue.getJobState(entry.jobId).catch(() => 'unknown');
  const live = jobState === 'active' || WAITING_STATES.has(jobState);
  if (!live) return { entry, jobState, disposition: 'clearable' };
  if (!entry.stopRequestedAt) return { entry, jobState, disposition: 'resumable' };

  // Stopped but still live: draining while the worker's heartbeat is fresh, a ghost once
  // it goes stale — never block a launch forever on a dead worker.
  const heartbeatAgeMs = await runRegistry.readHeartbeatAgeMs(entry.runToken).catch(() => null);
  return { entry, jobState, disposition: isEngineStale(heartbeatAgeMs) ? 'clearable' : 'draining' };
}

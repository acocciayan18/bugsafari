import type { RunRegistryEntry } from './RunRegistry.js';

import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[RegistryReconciler]');

// BullMQ states meaning the job is still going somewhere.
const LIVE_JOB_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children', 'active']);

// Narrow ports rather than the concrete classes: the reconciler needs a handful of
// operations, and typing it this way keeps it unit-testable without Redis or BullMQ.
export interface ReconcilerRegistry {
  listEntries(): Promise<RunRegistryEntry[]>;
  findByRunToken(runToken: string): Promise<RunRegistryEntry | null>;
  readSnapshot(runToken: string): Promise<unknown>;
  touch(runToken: string, userId: string | null): Promise<void>;
  clear(runToken: string, userId: string | null): Promise<void>;
}

export interface ReconcilerQueue {
  getJobState(jobId: string): Promise<string>;
  waitingJobRefs(): Promise<{ id: string; runToken: string }[]>;
  cancelQueuedJob(jobId: string): Promise<{ removed: boolean; state: string }>;
}

export interface ReconcilerVault {
  discard(runToken: string): Promise<void>;
}

export interface ReconcileResult {
  /** Registry entries dropped because their job finished or vanished. */
  clearedEntries: number;
  /** Waiting jobs removed because no registry entry references them. */
  removedGhostJobs: number;
}

/**
 * Keep the Redis run index and the BullMQ queue agreeing with each other, in both
 * directions.
 *
 * Forward: drop entries whose job no longer exists or has finished. Entries live for 2h
 * but jobs are removed after 1h (completed), and that gap left `findByOwner` handing back
 * runs whose job was gone, which the dashboard reported as phantom queued/active
 * sessions. A terminal entry is kept only while its snapshot survives, so a
 * post-completion refresh can still restore the finished run.
 *
 * Reverse: remove waiting jobs that no entry references. Such a job is unobservable and
 * uncontrollable by design — queue-subscribe, /api/session/active and stop all resolve
 * through the registry entry — yet it still holds a place in the FIFO line, so a fresh
 * run lands behind it and reports a queue position with nothing actually executing.
 * Ghosts accumulate whenever runs are enqueued into a fleet that has no worker.
 */
export async function reconcileRunRegistry(
  registry: ReconcilerRegistry,
  queue: ReconcilerQueue,
  authVault?: ReconcilerVault,
): Promise<ReconcileResult> {
  const entries = await registry.listEntries();
  const liveJobIds = new Set<string>();
  const knownRunTokens = new Set<string>();
  let clearedEntries = 0;

  for (const entry of entries) {
    // 'pending' means the enqueue is still mid-flight in the API process.
    if (entry.jobId === 'pending') {
      knownRunTokens.add(entry.runToken);
      continue;
    }

    const state = await queue.getJobState(entry.jobId).catch(() => 'unknown');
    if (LIVE_JOB_STATES.has(state)) {
      // Refresh the TTL so a long wait can never outlive its own index and be swept
      // below as a ghost.
      await registry.touch(entry.runToken, entry.userId).catch(() => undefined);
      liveJobIds.add(entry.jobId);
      knownRunTokens.add(entry.runToken);
      continue;
    }

    // Terminal or vanished. Keep it only while the replay snapshot is alive.
    const snapshot = await registry.readSnapshot(entry.runToken);
    if (snapshot) {
      knownRunTokens.add(entry.runToken);
      continue;
    }

    await registry.clear(entry.runToken, entry.userId);
    await authVault?.discard(entry.runToken);
    clearedEntries += 1;
    obsLog.info(`[RegistryReconciler] Cleared stale run ${entry.runCode} (token=${entry.runToken}, job ${entry.jobId} state=${state})`);
  }

  let removedGhostJobs = 0;
  const waiting = await queue.waitingJobRefs().catch(() => []);
  for (const job of waiting) {
    if (liveJobIds.has(job.id) || knownRunTokens.has(job.runToken)) continue;
    // A malformed payload carries no run token, so nothing here can vouch for it either
    // way. Leave it: the worker's own payload validation fails it fast.
    if (!job.runToken) continue;
    // Re-read before removing. listEntries() was sampled before this listing, so a launch
    // that registered in between is absent from the snapshot above and would otherwise be
    // destroyed while still mid-enqueue.
    const current = await registry.findByRunToken(job.runToken).catch(() => null);
    if (current) continue;
    // cancelQueuedJob refuses a locked (active) job, so a job claimed between the
    // listing and here is left alone rather than yanked from under its worker.
    const { removed, state } = await queue.cancelQueuedJob(job.id).catch(() => ({ removed: false, state: 'unknown' }));
    if (!removed) continue;
    removedGhostJobs += 1;
    obsLog.warn(`[RegistryReconciler] Removed orphaned waiting job ${job.id} (state=${state}) — no registry entry, so nothing could attach to, stop, or observe it.`);
  }

  return { clearedEntries, removedGhostJobs };
}

import type { RunRegistry } from './RunRegistry.js';
import type { TaskQueue } from './TaskQueue.js';
import type { AuthVault } from './AuthVault.js';

// BullMQ states meaning the job is still going somewhere.
const LIVE_JOB_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children', 'active']);

/**
 * Drop registry entries whose job no longer exists or has finished.
 *
 * Entries live for 2h but jobs are removed after 1h (completed) — that gap left
 * `findByOwner` handing back runs whose job was gone, which the dashboard then
 * reported as phantom queued/active sessions. A terminal entry is kept only
 * while its snapshot survives, so a post-completion refresh can still restore
 * the finished run.
 */
export async function reconcileRunRegistry(
  registry: RunRegistry,
  queue: TaskQueue,
  authVault?: AuthVault,
): Promise<number> {
  const entries = await registry.listEntries();
  let cleared = 0;

  for (const entry of entries) {
    // 'pending' means the enqueue is still mid-flight in the API process.
    if (entry.jobId === 'pending') continue;

    const state = await queue.getJobState(entry.jobId).catch(() => 'unknown');
    if (LIVE_JOB_STATES.has(state)) continue;

    // Terminal or vanished. Keep it only while the replay snapshot is alive.
    const snapshot = await registry.readSnapshot(entry.runId);
    if (snapshot) continue;

    await registry.clear(entry.runId, entry.userId);
    await authVault?.discard(entry.runId);
    cleared += 1;
    console.log(`[RegistryReconciler] Cleared stale run ${entry.runId} (job ${entry.jobId} state=${state})`);
  }

  return cleared;
}

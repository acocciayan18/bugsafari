import { Types } from 'mongoose';
import { SessionModel } from './models/SessionModel.js';
import { ForensicErrorModel } from './models/ForensicErrorModel.js';
import { ForensicTelemetryModel } from './models/ForensicTelemetryModel.js';
import { ForensicAnalysisModel } from './models/ForensicAnalysisModel.js';
import { BrainConfigModel } from './models/BrainConfigModel.js';
import { ConsoleLogModel } from './models/ConsoleLogModel.js';
import { NetworkLogModel } from './models/NetworkLogModel.js';

export type CascadeCounts = Record<string, number>;

const REAP_BATCH_SIZE = 500;

interface ChildCollection {
  name: string;
  deleteForSessions(ids: Types.ObjectId[]): Promise<number>;
  referencedSessionIds(): Promise<Types.ObjectId[]>;
}

// Each child collection points back at its session through its own field name,
// so the query is wrapped per collection rather than erasing the model types.
const CHILD_COLLECTIONS: ChildCollection[] = [
  {
    name: 'forensic_errors',
    deleteForSessions: async (ids) =>
      (await ForensicErrorModel.deleteMany({ forensicRunId: { $in: ids } })).deletedCount ?? 0,
    referencedSessionIds: async () => ForensicErrorModel.distinct('forensicRunId'),
  },
  {
    name: 'forensic_telemetry',
    deleteForSessions: async (ids) =>
      (await ForensicTelemetryModel.deleteMany({ forensicRunId: { $in: ids } })).deletedCount ?? 0,
    referencedSessionIds: async () => ForensicTelemetryModel.distinct('forensicRunId'),
  },
  {
    name: 'forensic_analysis',
    deleteForSessions: async (ids) =>
      (await ForensicAnalysisModel.deleteMany({ forensicRunId: { $in: ids } })).deletedCount ?? 0,
    referencedSessionIds: async () => ForensicAnalysisModel.distinct('forensicRunId'),
  },
  {
    name: 'brain_configs',
    deleteForSessions: async (ids) =>
      (await BrainConfigModel.deleteMany({ sessionId: { $in: ids } })).deletedCount ?? 0,
    referencedSessionIds: async () => BrainConfigModel.distinct('sessionId'),
  },
  {
    name: 'console_logs',
    deleteForSessions: async (ids) =>
      (await ConsoleLogModel.deleteMany({ forensicRunId: { $in: ids } })).deletedCount ?? 0,
    referencedSessionIds: async () => ConsoleLogModel.distinct('forensicRunId'),
  },
  {
    name: 'network_logs',
    deleteForSessions: async (ids) =>
      (await NetworkLogModel.deleteMany({ forensicRunId: { $in: ids } })).deletedCount ?? 0,
    referencedSessionIds: async () => NetworkLogModel.distinct('forensicRunId'),
  },
];

/**
 * Delete every child document belonging to a session. Callers must verify
 * ownership of the session before invoking this — it does no auth of its own.
 */
export async function deleteSessionCascade(sessionId: Types.ObjectId): Promise<CascadeCounts> {
  const results = await Promise.all(
    CHILD_COLLECTIONS.map(async (child) => [child.name, await child.deleteForSessions([sessionId])] as const),
  );
  return Object.fromEntries(results);
}

/**
 * Sweep child documents whose parent session no longer exists.
 *
 * The TTL index on `sessions` expires abandoned (never-saved) runs, but MongoDB's
 * TTL monitor does not cascade — this reclaims what it leaves behind. A child
 * whose session id is absent from `sessions` is unambiguously orphaned, since
 * the session row is always created before any child document is written.
 */
export async function reapExpiredSessionChildren(): Promise<CascadeCounts> {
  const totals: CascadeCounts = {};

  for (const child of CHILD_COLLECTIONS) {
    let removed = 0;
    const referencedIds = await child.referencedSessionIds();

    // Batched so a large backlog never builds one oversized $in.
    for (let offset = 0; offset < referencedIds.length; offset += REAP_BATCH_SIZE) {
      const batch = referencedIds.slice(offset, offset + REAP_BATCH_SIZE);
      const surviving = await SessionModel.find({ _id: { $in: batch } }).select('_id').lean();
      const alive = new Set(surviving.map((session) => session._id.toString()));
      const orphaned = batch.filter((id) => !alive.has(id.toString()));

      if (orphaned.length) {
        removed += await child.deleteForSessions(orphaned);
      }
    }

    totals[child.name] = removed;
  }

  return totals;
}

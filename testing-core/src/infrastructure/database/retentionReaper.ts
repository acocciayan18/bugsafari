import mongoose, { Types } from 'mongoose';
import { SessionModel } from './models/SessionModel.js';
import { ForensicErrorModel } from './models/ForensicErrorModel.js';
import { ForensicTelemetryModel } from './models/ForensicTelemetryModel.js';
import { ForensicAnalysisModel } from './models/ForensicAnalysisModel.js';
import { BrainConfigModel } from './models/BrainConfigModel.js';
import { ConsoleLogModel } from './models/ConsoleLogModel.js';
import { NetworkLogModel } from './models/NetworkLogModel.js';
import { selectOrphans } from './reapPolicy.js';

export type CascadeCounts = Record<string, number>;

const REAP_BATCH_SIZE = 500;
const MS_PER_DAY = 86_400_000;

// Trash retention: soft-deleted sessions survive this many days before the reaper
// permanently purges them (with their forensic cascade). Env-tunable, floored at 1
// so a misconfiguration can never purge same-day and defeat the recovery window.
export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const MIN_TRASH_RETENTION_DAYS = 1;

// Pure parse of the raw env value → a safe day count. Exported so the safety floor
// and default fallback are unit-testable without touching process.env.
export function parseTrashRetentionDays(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TRASH_RETENTION_DAYS;
  return Math.max(MIN_TRASH_RETENTION_DAYS, parsed);
}

export const TRASH_RETENTION_DAYS = parseTrashRetentionDays(process.env.BUGSAFARI_TRASH_RETENTION_DAYS);

// One child collection and the field pointing back at its session. This table is
// the single cascade mechanism — both the on-demand delete and the orphan sweep
// read it, so a new child collection can never be added to one and missed by the
// other. Names come from the models so a collection rename cannot silently
// detach a sweep.
interface ChildCollection {
  name: string;
  field: string;
}

const CHILD_COLLECTIONS: ChildCollection[] = [
  { name: ForensicErrorModel.collection.collectionName, field: 'forensicRunId' },
  { name: ForensicTelemetryModel.collection.collectionName, field: 'forensicRunId' },
  { name: ForensicAnalysisModel.collection.collectionName, field: 'forensicRunId' },
  { name: BrainConfigModel.collection.collectionName, field: 'sessionId' },
  { name: ConsoleLogModel.collection.collectionName, field: 'forensicRunId' },
  { name: NetworkLogModel.collection.collectionName, field: 'forensicRunId' },
  // Deprecated and modelless: nothing has written `findings` since verified
  // defects moved to forensic_errors + session.forensicTrace. Listed anyway so
  // pre-deprecation rows are reclaimed with their session instead of orphaning
  // permanently — the one thing dropping the model would otherwise have cost.
  { name: 'findings', field: 'sessionId' },
];

const collectionOf = (child: ChildCollection) => mongoose.connection.collection(child.name);

async function deleteForSessions(child: ChildCollection, ids: Types.ObjectId[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await collectionOf(child).deleteMany({ [child.field]: { $in: ids } });
  return result.deletedCount ?? 0;
}

/**
 * Session ids referenced by a child collection, streamed in bounded batches.
 *
 * A `$group` cursor rather than `distinct()`: distinct materializes every id ever
 * referenced into a single reply and fails outright past the 16 MB BSON ceiling —
 * a limit reached by lifetime history, not by orphan backlog, so the sweep would
 * start failing silently on exactly the deployments that need it most.
 */
async function* referencedSessionIdBatches(child: ChildCollection): AsyncGenerator<Types.ObjectId[]> {
  const cursor = collectionOf(child).aggregate<{ _id: Types.ObjectId | null }>(
    [{ $group: { _id: `$${child.field}` } }],
    { allowDiskUse: true, batchSize: REAP_BATCH_SIZE },
  );
  let batch: Types.ObjectId[] = [];
  for await (const doc of cursor) {
    if (!doc._id) continue; // Rows missing the back-reference are not attributable.
    batch.push(doc._id);
    if (batch.length >= REAP_BATCH_SIZE) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

/**
 * Delete every child document belonging to a session. Callers must verify
 * ownership of the session before invoking this — it does no auth of its own.
 */
export async function deleteSessionCascade(sessionId: Types.ObjectId): Promise<CascadeCounts> {
  const results = await Promise.all(
    CHILD_COLLECTIONS.map(async (child) => [child.name, await deleteForSessions(child, [sessionId])] as const),
  );
  return Object.fromEntries(results);
}

/**
 * Permanently purge Trash whose retention window has elapsed. Cascades each
 * session's forensic children first, then drops the sessions themselves — the
 * same order and child table the on-demand permanent delete uses, so no child
 * ever outlives its parent. Bounded per run; the hourly cadence drains backlog.
 *
 * Returns per-child removal counts plus a `sessions` total. Unlike a TTL index,
 * this cascades — which is exactly why Trash is reaper-driven, not TTL-driven.
 */
export async function purgeExpiredTrash(): Promise<CascadeCounts & { sessions: number }> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * MS_PER_DAY);
  const totals: CascadeCounts = {};

  const expired = await SessionModel.find({ deletedAt: { $type: 'date', $lte: cutoff } })
    .select('_id')
    .limit(REAP_BATCH_SIZE)
    .lean();

  if (expired.length === 0) return { ...totals, sessions: 0 };

  const ids = expired.map((session) => session._id);
  for (const child of CHILD_COLLECTIONS) {
    totals[child.name] = await deleteForSessions(child, ids);
  }
  const result = await SessionModel.deleteMany({ _id: { $in: ids } });
  return { ...totals, sessions: result.deletedCount ?? 0 };
}

/**
 * Sweep child documents whose parent session no longer exists.
 *
 * The TTL index on `sessions` expires abandoned (never-saved) runs, but MongoDB's
 * TTL monitor does not cascade — this reclaims what it leaves behind.
 */
export async function reapExpiredSessionChildren(): Promise<CascadeCounts> {
  const totals: CascadeCounts = {};

  for (const child of CHILD_COLLECTIONS) {
    let removed = 0;
    for await (const batch of referencedSessionIdBatches(child)) {
      const surviving = await SessionModel.find({ _id: { $in: batch } }).select('_id').lean();
      const orphaned = selectOrphans(batch, surviving.map((session) => session._id.toString()));
      removed += await deleteForSessions(child, orphaned);
    }
    totals[child.name] = removed;
  }

  return totals;
}

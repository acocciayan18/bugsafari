import { SessionModel } from './models/SessionModel.js';
import { generateUniqueRunCode } from './runCodeGenerator.js';

import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[runIdBackfill]');

// Batch size per pass — bounded so a large legacy collection is walked without
// holding every doc in memory at once.
const BACKFILL_BATCH_SIZE = 500;

// Assign a unique RUN- code to every legacy session doc missing one. Idempotent:
// re-running only touches docs still lacking a runId. Individual duplicate-key
// races (a concurrent run stamping the same doc) are swallowed so one collision
// never aborts the sweep.
export async function backfillRunIds(): Promise<number> {
  let assigned = 0;

  for (;;) {
    const batch = await SessionModel.find({ runId: { $in: [null, undefined] } })
      .select('_id')
      .limit(BACKFILL_BATCH_SIZE)
      .lean();
    if (batch.length === 0) break;

    for (const doc of batch) {
      const code = await generateUniqueRunCode(async (candidate) => !!(await SessionModel.exists({ runId: candidate })));
      try {
        await SessionModel.updateOne({ _id: doc._id, runId: { $in: [null, undefined] } }, { $set: { runId: code } });
        assigned += 1;
      } catch (error) {
        const e = error as { code?: number };
        if (e?.code !== 11000) throw error; // only a dup-code race is tolerated
        obsLog.warn(`[runIdBackfill] runId race on ${String(doc._id)} — skipping, next pass will retry.`);
      }
    }

    // A short batch means the remaining unassigned docs fit in one pass.
    if (batch.length < BACKFILL_BATCH_SIZE) break;
  }

  if (assigned > 0) obsLog.info(`[runIdBackfill] Assigned runId to ${assigned} legacy session(s).`);
  return assigned;
}

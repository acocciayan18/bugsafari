// One-shot cleanup: network_logs once stored every request (incl. 2xx/3xx
// successes). The pipeline now persists only actionable failures, so historic
// success rows are dead weight the saved-report Network tab already hides.
//
// Deletes rows whose statusCode is a real number < 400. Transport failures
// (statusCode null/absent) and HTTP errors (>=400) are kept — the $type:'number'
// guard is required because BSON null compares < 400 and would match otherwise.
// Idempotent and self-terminating: the filter set shrinks to empty on re-run.
// Run: npx tsx scripts/purge-network-successes.ts   (npm run db:purge:network-successes)

import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database/mongooseClient.js';
import { NetworkLogModel } from '../src/infrastructure/database/models/NetworkLogModel.js';

const SUCCESS_FILTER = { statusCode: { $type: 'number', $lt: 400 } } as const;

async function main(): Promise<void> {
  const connected = await connectDatabase();
  if (!connected) {
    console.error('[purge] Database connection failed — nothing purged.');
    process.exitCode = 1;
    return;
  }

  const before = await NetworkLogModel.collection.countDocuments(SUCCESS_FILTER);
  const { deletedCount } = await NetworkLogModel.collection.deleteMany(SUCCESS_FILTER);
  console.log(`[purge] network_logs: matched ${before}, deleted ${deletedCount} success row(s).`);

  await disconnectDatabase();
  console.log('[purge] Done.');
}

await main();

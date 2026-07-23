// One-shot index reconciliation. Delegates to the shared indexSync module so the
// script and the boot hook can never drift. syncIndexes() creates new indexes AND
// drops ones no longer declared (removing stale forensic/user indexes).
// Run: npx tsx scripts/sync-indexes.ts   (npm run db:sync-indexes)

import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database/mongooseClient.js';
import { syncAllIndexes, INDEXED_MODELS } from '../src/infrastructure/database/indexSync.js';

async function main(): Promise<void> {
  const connected = await connectDatabase();
  if (!connected) {
    console.error('[sync-indexes] Database connection failed — nothing synced.');
    process.exitCode = 1;
    return;
  }

  const { synced, failed } = await syncAllIndexes({ verbose: true });

  await disconnectDatabase();
  if (failed > 0) process.exitCode = 1;
  console.log(`[sync-indexes] Done. ${synced}/${INDEXED_MODELS.length} collections synced.`);
}

await main();

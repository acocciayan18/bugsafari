// Sweep forensic child documents whose parent session has expired via TTL.
// Run: npx tsx scripts/reap-orphans.ts   (npm run db:reap)

import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database/mongooseClient.js';
import { reapExpiredSessionChildren } from '../src/infrastructure/database/retentionReaper.js';

async function main(): Promise<void> {
  const connected = await connectDatabase();
  if (!connected) {
    console.error('[reap] Database connection failed — nothing reaped.');
    process.exitCode = 1;
    return;
  }

  const totals = await reapExpiredSessionChildren();
  for (const [collection, count] of Object.entries(totals)) {
    console.log(`[reap] ${collection}: ${count} orphaned document(s) removed`);
  }

  await disconnectDatabase();
  console.log('[reap] Done.');
}

await main();

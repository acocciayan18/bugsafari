// One-shot index reconciliation. Production runs with autoIndex:false, so index
// changes in the schemas only reach MongoDB through this script.
// syncIndexes() creates new indexes AND drops ones no longer declared, which is
// what removes the stale forensic_errors timestamp index and the duplicate
// users.email index.
// Run: npx tsx scripts/sync-indexes.ts   (npm run db:sync-indexes)

import type { Model } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/infrastructure/database/mongooseClient.js';
import { SessionModel } from '../src/infrastructure/database/models/SessionModel.js';
import { ForensicErrorModel } from '../src/infrastructure/database/models/ForensicErrorModel.js';
import { ForensicTelemetryModel } from '../src/infrastructure/database/models/ForensicTelemetryModel.js';
import { ForensicAnalysisModel } from '../src/infrastructure/database/models/ForensicAnalysisModel.js';
import { ConsoleLogModel } from '../src/infrastructure/database/models/ConsoleLogModel.js';
import { NetworkLogModel } from '../src/infrastructure/database/models/NetworkLogModel.js';
import { BrainConfigModel } from '../src/infrastructure/database/models/BrainConfigModel.js';
import { FindingModel } from '../src/infrastructure/database/models/FindingModel.js';
import { UserModel } from '../src/infrastructure/database/models/UserModel.js';
import { SupportTicketModel } from '../src/infrastructure/database/models/SupportTicketModel.js';
import { RefreshTokenModel } from '../src/infrastructure/database/models/RefreshTokenModel.js';

const MODELS: Model<unknown>[] = [
  SessionModel,
  ForensicErrorModel,
  ForensicTelemetryModel,
  ForensicAnalysisModel,
  ConsoleLogModel,
  NetworkLogModel,
  BrainConfigModel,
  FindingModel,
  UserModel,
  SupportTicketModel,
  RefreshTokenModel,
] as Model<unknown>[];

async function main(): Promise<void> {
  const connected = await connectDatabase();
  if (!connected) {
    console.error('[sync-indexes] Database connection failed — nothing synced.');
    process.exitCode = 1;
    return;
  }

  let failed = 0;

  for (const model of MODELS) {
    const name = model.collection.collectionName;
    try {
      const dropped = await model.syncIndexes();
      console.log(`[sync-indexes] ${name}: dropped=${JSON.stringify(dropped)}`);
      for (const index of await model.collection.indexes()) {
        console.log(`    ${index.name} ${JSON.stringify(index.key)}${index.expireAfterSeconds !== undefined ? ` ttl=${index.expireAfterSeconds}s` : ''}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[sync-indexes] ${name} FAILED:`, error instanceof Error ? error.message : error);
    }
  }

  await disconnectDatabase();
  if (failed > 0) process.exitCode = 1;
  console.log(`[sync-indexes] Done. ${MODELS.length - failed}/${MODELS.length} collections synced.`);
}

await main();

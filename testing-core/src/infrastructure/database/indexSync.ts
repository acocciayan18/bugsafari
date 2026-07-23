// Single source of truth for index reconciliation. Production runs autoIndex:false,
// so declared index changes only reach MongoDB through syncIndexes(). Shared by the
// boot hook (guarded, non-fatal) and the standalone db:sync-indexes script.

import type { Model } from 'mongoose';
import { SessionModel } from './models/SessionModel.js';
import { ForensicErrorModel } from './models/ForensicErrorModel.js';
import { ForensicTelemetryModel } from './models/ForensicTelemetryModel.js';
import { ForensicAnalysisModel } from './models/ForensicAnalysisModel.js';
import { ConsoleLogModel } from './models/ConsoleLogModel.js';
import { NetworkLogModel } from './models/NetworkLogModel.js';
import { BrainConfigModel } from './models/BrainConfigModel.js';
import { FindingModel } from './models/FindingModel.js';
import { UserModel } from './models/UserModel.js';
import { SupportTicketModel } from './models/SupportTicketModel.js';
import { RefreshTokenModel } from './models/RefreshTokenModel.js';

export const INDEXED_MODELS: Model<unknown>[] = [
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

export interface IndexSyncResult {
  synced: number;
  failed: number;
}

// Reconcile every model's indexes. syncIndexes() creates new indexes AND drops ones
// no longer declared. Per-model failures are isolated and reported, never thrown —
// a single collection's index conflict must not abort boot or the whole sweep.
export async function syncAllIndexes(options: { verbose?: boolean } = {}): Promise<IndexSyncResult> {
  let failed = 0;
  for (const model of INDEXED_MODELS) {
    const name = model.collection.collectionName;
    try {
      const dropped = await model.syncIndexes();
      console.log(`[indexSync] ${name}: dropped=${JSON.stringify(dropped)}`);
      if (options.verbose) {
        for (const index of await model.collection.indexes()) {
          console.log(`    ${index.name} ${JSON.stringify(index.key)}${index.expireAfterSeconds !== undefined ? ` ttl=${index.expireAfterSeconds}s` : ''}`);
        }
      }
    } catch (error) {
      failed += 1;
      console.error(`[indexSync] ${name} FAILED:`, error instanceof Error ? error.message : error);
    }
  }
  return { synced: INDEXED_MODELS.length - failed, failed };
}

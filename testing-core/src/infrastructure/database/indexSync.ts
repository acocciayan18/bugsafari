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
import { UserModel } from './models/UserModel.js';
import { SupportTicketModel } from './models/SupportTicketModel.js';
import { RefreshTokenModel } from './models/RefreshTokenModel.js';
import { ShareLinkModel } from './models/ShareLinkModel.js';

import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[indexSync]');

export const INDEXED_MODELS: Model<unknown>[] = [
  SessionModel,
  ForensicErrorModel,
  ForensicTelemetryModel,
  ForensicAnalysisModel,
  ConsoleLogModel,
  NetworkLogModel,
  BrainConfigModel,
  // `findings` is deprecated and has no model: nothing writes or reads it, so
  // syncing its indexes only bought write cost. retentionReaper still sweeps it.
  UserModel,
  SupportTicketModel,
  RefreshTokenModel,
  // Was unsynced: its TTL-reap + unique-token + active-uniqueness indexes only reach
  // MongoDB through here (autoIndex:false in prod).
  ShareLinkModel,
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
      obsLog.info(`[indexSync] ${name}: dropped=${JSON.stringify(dropped)}`);
      if (options.verbose) {
        for (const index of await model.collection.indexes()) {
          obsLog.info(`    ${index.name} ${JSON.stringify(index.key)}${index.expireAfterSeconds !== undefined ? ` ttl=${index.expireAfterSeconds}s` : ''}`);
        }
      }
    } catch (error) {
      failed += 1;
      obsLog.error(`[indexSync] ${name} FAILED:`, error instanceof Error ? error.message : error);
    }
  }
  return { synced: INDEXED_MODELS.length - failed, failed };
}

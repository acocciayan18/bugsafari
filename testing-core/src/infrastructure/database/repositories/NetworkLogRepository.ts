import { Types } from 'mongoose';
import { NetworkLogModel, INetworkLog } from '../models/NetworkLogModel.js';
import type { NetworkLogEntry } from '../../../../../shared/types.js';

export class NetworkLogRepository {
  // Batch-insert a run's network log. Silent no-op on empty input.
  async createMany(forensicRunId: string | Types.ObjectId, entries: NetworkLogEntry[]): Promise<void> {
    if (!entries.length) return;
    const runId = new Types.ObjectId(forensicRunId);
    const documents = entries.map((e) => ({ forensicRunId: runId, ...e }));
    await NetworkLogModel.insertMany(documents, { ordered: false });
  }

  // All network rows for a run, chronological.
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<INetworkLog[]> {
    return NetworkLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ timestamp: 1 })
      .exec();
  }
}

export const networkLogRepository = new NetworkLogRepository();

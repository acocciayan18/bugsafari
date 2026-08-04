import { Types } from 'mongoose';
import { NetworkLogModel, INetworkLog } from '../models/NetworkLogModel.js';
import type { NetworkLogEntry } from '../../../../../shared/types.js';
import { MAX_FORENSIC_ROWS } from '../queryLimits.js';
import { capText, MAX_MESSAGE_LEN, MAX_URL_LEN } from '../logSanitizer.js';

export class NetworkLogRepository {
  // Batch-insert a run's network log. Silent no-op on empty input.
  async createMany(forensicRunId: string | Types.ObjectId, entries: NetworkLogEntry[]): Promise<void> {
    if (!entries.length) return;
    const runId = new Types.ObjectId(forensicRunId);
    // Redact secrets + cap free text at the persist boundary — a target URL or error
    // message can carry a token/PII and unbounded length. Explicit Date cast: the
    // wire type is an ISO string, the column is a Date.
    const documents = entries.map((e) => ({
      ...e,
      url: capText(e.url, MAX_URL_LEN) ?? '',
      message: capText(e.message, MAX_MESSAGE_LEN),
      errorText: capText(e.errorText, MAX_MESSAGE_LEN),
      forensicRunId: runId,
      timestamp: new Date(e.timestamp),
    }));
    await NetworkLogModel.insertMany(documents, { ordered: false });
  }

  // All network rows for a run, chronological. Bounded and lean — callers only read fields.
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<INetworkLog[]> {
    return NetworkLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ timestamp: 1 })
      .limit(MAX_FORENSIC_ROWS)
      .lean<INetworkLog[]>()
      .exec();
  }

  // One chronological page — same order as findByRunId, bounded by offset/limit.
  async findPageByRunId(forensicRunId: string | Types.ObjectId, limit: number, offset: number): Promise<INetworkLog[]> {
    return NetworkLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ timestamp: 1 })
      .skip(Math.max(0, offset))
      .limit(Math.min(Math.max(1, limit), MAX_FORENSIC_ROWS))
      .lean<INetworkLog[]>()
      .exec();
  }

  async countByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    return NetworkLogModel.countDocuments({ forensicRunId: new Types.ObjectId(forensicRunId) }).exec();
  }
}

export const networkLogRepository = new NetworkLogRepository();

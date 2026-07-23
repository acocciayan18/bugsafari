import { Types } from 'mongoose';
import { ConsoleLogModel, IConsoleLog } from '../models/ConsoleLogModel.js';
import type { ConsoleLogEntry } from '../../../../../shared/types.js';
import { MAX_FORENSIC_ROWS } from '../queryLimits.js';

export class ConsoleLogRepository {
  // Batch-insert a run's console log. Silent no-op on empty input.
  async createMany(forensicRunId: string | Types.ObjectId, entries: ConsoleLogEntry[]): Promise<void> {
    if (!entries.length) return;
    const runId = new Types.ObjectId(forensicRunId);
    // Explicit Date cast: the wire type is an ISO string, the column is a Date.
    const documents = entries.map((e) => ({ ...e, forensicRunId: runId, timestamp: new Date(e.timestamp) }));
    await ConsoleLogModel.insertMany(documents, { ordered: false });
  }

  // All console rows for a run, chronological. Bounded and lean — callers only read fields.
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<IConsoleLog[]> {
    return ConsoleLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ timestamp: 1 })
      .limit(MAX_FORENSIC_ROWS)
      .lean<IConsoleLog[]>()
      .exec();
  }

  // One chronological page — same order as findByRunId, bounded by offset/limit.
  async findPageByRunId(forensicRunId: string | Types.ObjectId, limit: number, offset: number): Promise<IConsoleLog[]> {
    return ConsoleLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ timestamp: 1 })
      .skip(Math.max(0, offset))
      .limit(Math.min(Math.max(1, limit), MAX_FORENSIC_ROWS))
      .lean<IConsoleLog[]>()
      .exec();
  }

  async countByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    return ConsoleLogModel.countDocuments({ forensicRunId: new Types.ObjectId(forensicRunId) }).exec();
  }
}

export const consoleLogRepository = new ConsoleLogRepository();

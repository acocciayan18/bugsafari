import { Types } from 'mongoose';
import { ConsoleLogModel, IConsoleLog } from '../models/ConsoleLogModel.js';
import type { ConsoleLogEntry } from '../../../../../shared/types.js';

export class ConsoleLogRepository {
  // Batch-insert a run's console log. Silent no-op on empty input.
  async createMany(forensicRunId: string | Types.ObjectId, entries: ConsoleLogEntry[]): Promise<void> {
    if (!entries.length) return;
    const runId = new Types.ObjectId(forensicRunId);
    const documents = entries.map((e) => ({ forensicRunId: runId, ...e }));
    await ConsoleLogModel.insertMany(documents, { ordered: false });
  }

  // All console rows for a run, chronological.
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<IConsoleLog[]> {
    return ConsoleLogModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ timestamp: 1 })
      .exec();
  }
}

export const consoleLogRepository = new ConsoleLogRepository();

import { Types } from 'mongoose';
import { TelemetryEventModel, ITelemetryEvent } from '../models/TelemetryEventModel.js';
import type { TelemetryEvent } from '../../../../../shared/types.js';
import { MAX_FORENSIC_ROWS } from '../queryLimits.js';

// Persisted-row payload: an ordered TelemetryEvent stamped with its run seq.
export interface TelemetryEventRow {
  seq: number;
  timestamp: Date;
  type: string;
  meta: unknown;
}

export class TelemetryEventRepository {
  // Batch-insert a run's telemetry events. Silent no-op on empty input; unordered
  // so one bad row never aborts the batch.
  async createMany(forensicRunId: string | Types.ObjectId, rows: TelemetryEventRow[]): Promise<void> {
    if (!rows.length) return;
    const runId = new Types.ObjectId(forensicRunId);
    const documents = rows.map((r) => ({ ...r, forensicRunId: runId }));
    await TelemetryEventModel.insertMany(documents, { ordered: false });
  }

  // Full replay stream for a run, in emit order. Bounded by MAX_FORENSIC_ROWS.
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<TelemetryEvent[]> {
    const rows = await TelemetryEventModel.find({ forensicRunId: new Types.ObjectId(forensicRunId) })
      .sort({ seq: 1 })
      .limit(MAX_FORENSIC_ROWS)
      .lean<ITelemetryEvent[]>()
      .exec();
    return rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      type: r.type,
      meta: r.meta,
    }));
  }

  async countByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    return TelemetryEventModel.countDocuments({ forensicRunId: new Types.ObjectId(forensicRunId) }).exec();
  }
}

export const telemetryEventRepository = new TelemetryEventRepository();

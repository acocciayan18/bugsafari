import { ForensicTelemetryModel, IForensicTelemetry } from '../models/ForensicTelemetryModel.js';
import { Types } from 'mongoose';

/**
 * Repository for forensic_telemetry database operations
 */
export class ForensicTelemetryRepository {
  /**
   * Upsert the single telemetry document for a run. One row per run — repeated
   * calls (initial browser info, final metrics) update in place instead of
   * accumulating dead rows only the latest of which is ever read.
   */
  async upsertForRun(data: {
    forensicRunId: Types.ObjectId;
    browser: string;
    browserVersion: string;
    browserEngine?: string;
    operatingSystem: string;
    platform?: string;
    screenResolution?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    memoryUsage?: number;
    cpuUsage?: number;
    executionDuration?: number;
    requestsCount?: number;
    pageCount?: number;
    interactionCount?: number;
    failureCount?: number;
  }): Promise<IForensicTelemetry | null> {
    const { forensicRunId, ...rest } = data;
    return ForensicTelemetryModel.findOneAndUpdate(
      { forensicRunId },
      { $set: rest, $setOnInsert: { forensicRunId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }

  /**
   * Get the latest telemetry record for a forensic run
   */
  async findLatestByForensicRunId(forensicRunId: Types.ObjectId | string): Promise<IForensicTelemetry | null> {
    const objectId = typeof forensicRunId === 'string' ? new Types.ObjectId(forensicRunId) : forensicRunId;
    return ForensicTelemetryModel.findOne({ forensicRunId: objectId })
      .sort({ timestamp: -1 })
      .lean<IForensicTelemetry>()
      .exec();
  }
}

// Export singleton instance
export const forensicTelemetryRepository = new ForensicTelemetryRepository();

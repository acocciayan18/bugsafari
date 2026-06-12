import { ForensicTelemetryModel, IForensicTelemetry } from '../models/ForensicTelemetryModel.js';
import { Types } from 'mongoose';

/**
 * Repository for forensic_telemetry database operations
 */
export class ForensicTelemetryRepository {
  /**
   * Create a new forensic telemetry record
   */
  async create(data: {
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
    loadTimes?: Array<{
      url: string;
      loadTime: number;
      timestamp: Date;
    }>;
  }): Promise<IForensicTelemetry> {
    const telemetry = new ForensicTelemetryModel(data);
    return telemetry.save();
  }

  /**
   * Get all telemetry records for a forensic run
   */
  async findByForensicRunId(forensicRunId: Types.ObjectId | string): Promise<IForensicTelemetry[]> {
    const objectId = typeof forensicRunId === 'string' ? new Types.ObjectId(forensicRunId) : forensicRunId;
    return ForensicTelemetryModel.find({ forensicRunId: objectId }).sort({ timestamp: -1 });
  }

  /**
   * Get the latest telemetry record for a forensic run
   */
  async findLatestByForensicRunId(forensicRunId: Types.ObjectId | string): Promise<IForensicTelemetry | null> {
    const objectId = typeof forensicRunId === 'string' ? new Types.ObjectId(forensicRunId) : forensicRunId;
    return ForensicTelemetryModel.findOne({ forensicRunId: objectId }).sort({ timestamp: -1 });
  }

  /**
   * Update telemetry metrics for a run
   */
  async updateMetrics(
    forensicRunId: Types.ObjectId | string,
    updates: {
      executionDuration?: number;
      requestsCount?: number;
      pageCount?: number;
      interactionCount?: number;
      failureCount?: number;
      memoryUsage?: number;
      cpuUsage?: number;
    },
  ): Promise<IForensicTelemetry | null> {
    const objectId = typeof forensicRunId === 'string' ? new Types.ObjectId(forensicRunId) : forensicRunId;
    return ForensicTelemetryModel.findOneAndUpdate(
      { forensicRunId: objectId },
      { $set: updates },
      { new: true },
    );
  }

  /**
   * Add a load time entry
   */
  async addLoadTime(
    forensicRunId: Types.ObjectId | string,
    loadTime: {
      url: string;
      loadTime: number;
      timestamp: Date;
    },
  ): Promise<IForensicTelemetry | null> {
    const objectId = typeof forensicRunId === 'string' ? new Types.ObjectId(forensicRunId) : forensicRunId;
    return ForensicTelemetryModel.findOneAndUpdate(
      { forensicRunId: objectId },
      { $push: { loadTimes: loadTime } },
      { new: true },
    );
  }
}

// Export singleton instance
export const forensicTelemetryRepository = new ForensicTelemetryRepository();

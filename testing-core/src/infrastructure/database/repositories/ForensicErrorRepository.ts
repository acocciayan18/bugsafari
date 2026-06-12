import { Types } from 'mongoose';
import {
  ForensicErrorModel,
  IForensicError,
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../models/ForensicErrorModel.js';

export interface CreateForensicErrorParams {
  forensicRunId: string | Types.ObjectId;
  type: ForensicErrorType;
  severity: ForensicErrorSeverity;
  message: string;
  stackTrace?: string;
  url?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseText?: string;
  filename?: string;
  lineNumber?: number;
  columnNumber?: number;
  selector?: string;
  action?: string;
}

export class ForensicErrorRepository {
  /**
   * Create a new forensic error record
   */
  async create(params: CreateForensicErrorParams): Promise<IForensicError> {
    const error = new ForensicErrorModel({
      forensicRunId: new Types.ObjectId(params.forensicRunId),
      type: params.type,
      severity: params.severity,
      message: params.message,
      stackTrace: params.stackTrace,
      url: params.url,
      endpoint: params.endpoint,
      method: params.method,
      statusCode: params.statusCode,
      responseText: params.responseText,
      filename: params.filename,
      lineNumber: params.lineNumber,
      columnNumber: params.columnNumber,
      selector: params.selector,
      action: params.action,
    });

    return error.save();
  }

  /**
   * Create multiple forensic errors in batch
   */
  async createMany(errors: CreateForensicErrorParams[]): Promise<IForensicError[]> {
    const documents = errors.map((params) => ({
      forensicRunId: new Types.ObjectId(params.forensicRunId),
      type: params.type,
      severity: params.severity,
      message: params.message,
      stackTrace: params.stackTrace,
      url: params.url,
      endpoint: params.endpoint,
      method: params.method,
      statusCode: params.statusCode,
      responseText: params.responseText,
      filename: params.filename,
      lineNumber: params.lineNumber,
      columnNumber: params.columnNumber,
      selector: params.selector,
      action: params.action,
    }));

    return ForensicErrorModel.insertMany(documents) as unknown as Promise<IForensicError[]>;
  }

  /**
   * Find all errors for a forensic run
   */
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<IForensicError[]> {
    return ForensicErrorModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find errors by type for a forensic run
   */
  async findByType(
    forensicRunId: string | Types.ObjectId,
    type: ForensicErrorType,
  ): Promise<IForensicError[]> {
    return ForensicErrorModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
      type,
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find errors by severity for a forensic run
   */
  async findBySeverity(
    forensicRunId: string | Types.ObjectId,
    severity: ForensicErrorSeverity,
  ): Promise<IForensicError[]> {
    return ForensicErrorModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
      severity,
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get error count by type for a forensic run
   */
  async getCountByType(forensicRunId: string | Types.ObjectId): Promise<Record<string, number>> {
    const results = await ForensicErrorModel.aggregate([
      {
        $match: { forensicRunId: new Types.ObjectId(forensicRunId) },
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap: Record<string, number> = {};
    for (const result of results) {
      countMap[result._id] = result.count;
    }
    return countMap;
  }

  /**
   * Get error count by severity for a forensic run
   */
  async getCountBySeverity(
    forensicRunId: string | Types.ObjectId,
  ): Promise<Record<ForensicErrorSeverity, number>> {
    const results = await ForensicErrorModel.aggregate([
      {
        $match: { forensicRunId: new Types.ObjectId(forensicRunId) },
      },
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap: Record<ForensicErrorSeverity, number> = {
      [ForensicErrorSeverity.CRITICAL]: 0,
      [ForensicErrorSeverity.HIGH]: 0,
      [ForensicErrorSeverity.MEDIUM]: 0,
      [ForensicErrorSeverity.LOW]: 0,
      [ForensicErrorSeverity.INFO]: 0,
    };

    for (const result of results) {
      if (result._id in countMap) {
        countMap[result._id as ForensicErrorSeverity] = result.count;
      }
    }
    return countMap;
  }

  /**
   * Delete all errors for a forensic run
   */
  async deleteByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    const result = await ForensicErrorModel.deleteMany({
      forensicRunId: new Types.ObjectId(forensicRunId),
    });
    return result.deletedCount;
  }
}

// Export singleton instance
export const forensicErrorRepository = new ForensicErrorRepository();

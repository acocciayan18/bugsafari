import { Types } from 'mongoose';
import {
  ForensicScreenshotModel,
  IForensicScreenshot,
  ForensicScreenshotType,
} from '../models/ForensicScreenshotModel.js';

export type { IForensicScreenshot };

export interface CreateForensicScreenshotParams {
  forensicRunId: string | Types.ObjectId;
  screenshotType: ForensicScreenshotType;
  imageData: string;
  filePath?: string;
  url?: string;
  errorMessage?: string;
  stepNumber?: number;
}

export class ForensicScreenshotRepository {
  /**
   * Create a new forensic screenshot record
   */
  async create(params: CreateForensicScreenshotParams): Promise<IForensicScreenshot> {
    const screenshot = new ForensicScreenshotModel({
      forensicRunId: new Types.ObjectId(params.forensicRunId),
      screenshotType: params.screenshotType,
      imageData: params.imageData,
      filePath: params.filePath,
      url: params.url,
      errorMessage: params.errorMessage,
      stepNumber: params.stepNumber,
    });

    return screenshot.save();
  }

  /**
   * Find all screenshots for a forensic run
   */
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<IForensicScreenshot[]> {
    return ForensicScreenshotModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
    })
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Find screenshots by type for a forensic run
   */
  async findByType(
    forensicRunId: string | Types.ObjectId,
    screenshotType: ForensicScreenshotType,
  ): Promise<IForensicScreenshot[]> {
    return ForensicScreenshotModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
      screenshotType,
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find the initial screenshot for a forensic run
   */
  async findInitial(forensicRunId: string | Types.ObjectId): Promise<IForensicScreenshot | null> {
    return ForensicScreenshotModel.findOne({
      forensicRunId: new Types.ObjectId(forensicRunId),
      screenshotType: ForensicScreenshotType.INITIAL,
    })
      .sort({ createdAt: 1 })
      .exec();
  }

  /**
   * Find the final screenshot for a forensic run
   */
  async findFinal(forensicRunId: string | Types.ObjectId): Promise<IForensicScreenshot | null> {
    return ForensicScreenshotModel.findOne({
      forensicRunId: new Types.ObjectId(forensicRunId),
      screenshotType: ForensicScreenshotType.FINAL,
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find all failure screenshots for a forensic run
   */
  async findFailures(forensicRunId: string | Types.ObjectId): Promise<IForensicScreenshot[]> {
    return ForensicScreenshotModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
      screenshotType: {
        $in: [
          ForensicScreenshotType.FAILURE,
          ForensicScreenshotType.JS_EXCEPTION,
          ForensicScreenshotType.API_FAILURE,
          ForensicScreenshotType.NAVIGATION_FAILURE,
        ],
      },
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get screenshot count by type for a forensic run
   */
  async getCountByType(forensicRunId: string | Types.ObjectId): Promise<Record<string, number>> {
    const results = await ForensicScreenshotModel.aggregate([
      {
        $match: { forensicRunId: new Types.ObjectId(forensicRunId) },
      },
      {
        $group: {
          _id: '$screenshotType',
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
   * Get total screenshot count for a forensic run
   */
  async getCount(forensicRunId: string | Types.ObjectId): Promise<number> {
    return ForensicScreenshotModel.countDocuments({
      forensicRunId: new Types.ObjectId(forensicRunId),
    }).exec();
  }

  /**
   * Delete all screenshots for a forensic run
   */
  async deleteByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    const result = await ForensicScreenshotModel.deleteMany({
      forensicRunId: new Types.ObjectId(forensicRunId),
    });
    return result.deletedCount;
  }
}

// Export singleton instance
export const forensicScreenshotRepository = new ForensicScreenshotRepository();

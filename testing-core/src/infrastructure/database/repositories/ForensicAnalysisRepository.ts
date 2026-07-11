import { Types } from 'mongoose';
import {
  ForensicAnalysisModel,
  IForensicAnalysis,
  ForensicAnalysisRiskLevel,
  determineRiskLevel,
} from '../models/ForensicAnalysisModel.js';

export interface CreateForensicAnalysisParams {
  forensicRunId: string | Types.ObjectId;
  rootCause: string;
  riskScore: number;
  riskLevel?: ForensicAnalysisRiskLevel;
  recommendations: string[];
  errorCount?: number;
  apiFailureCount?: number;
  criticalErrorCount?: number;
  jsExceptionCount?: number;
  screenshotCount?: number;
}

export class ForensicAnalysisRepository {
  /**
   * Create a new forensic analysis record
   */
  async create(params: CreateForensicAnalysisParams): Promise<IForensicAnalysis> {
    // Determine risk level if not provided
    const riskLevel = params.riskLevel ?? determineRiskLevel(params.riskScore);

    const analysis = new ForensicAnalysisModel({
      forensicRunId: new Types.ObjectId(params.forensicRunId),
      rootCause: params.rootCause,
      riskScore: params.riskScore,
      riskLevel,
      recommendations: params.recommendations,
      errorCount: params.errorCount ?? 0,
      apiFailureCount: params.apiFailureCount ?? 0,
      criticalErrorCount: params.criticalErrorCount ?? 0,
      jsExceptionCount: params.jsExceptionCount ?? 0,
      screenshotCount: params.screenshotCount ?? 0,
    });

    return analysis.save();
  }

  /**
   * Find analysis by forensic run ID
   */
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<IForensicAnalysis | null> {
    return ForensicAnalysisModel.findOne({
      forensicRunId: new Types.ObjectId(forensicRunId),
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find the latest analysis (most recent)
   */
  async findLatest(limit = 10): Promise<IForensicAnalysis[]> {
    return ForensicAnalysisModel.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Tenant-scoped: most recent analysis whose run belongs to the caller's own sessions.
   * runIds are the caller's SafariSession _ids — never trust an unfiltered latest.
   */
  async findLatestForRuns(runIds: (string | Types.ObjectId)[]): Promise<IForensicAnalysis | null> {
    if (runIds.length === 0) return null;
    return ForensicAnalysisModel.findOne({
      forensicRunId: { $in: runIds.map((id) => new Types.ObjectId(id)) },
    })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Find analyses by risk level
   */
  async findByRiskLevel(
    riskLevel: ForensicAnalysisRiskLevel,
    limit = 10,
  ): Promise<IForensicAnalysis[]> {
    return ForensicAnalysisModel.find({ riskLevel })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get high-risk analyses (HIGH or CRITICAL)
   */
  async findHighRisk(limit = 10): Promise<IForensicAnalysis[]> {
    return ForensicAnalysisModel.find({
      riskLevel: { $in: [ForensicAnalysisRiskLevel.HIGH, ForensicAnalysisRiskLevel.CRITICAL] },
    })
      .sort({ riskScore: -1, createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Delete analysis by forensic run ID
   */
  async deleteByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    const result = await ForensicAnalysisModel.deleteMany({
      forensicRunId: new Types.ObjectId(forensicRunId),
    });
    return result.deletedCount;
  }

  /**
   * Get analysis statistics
   */
  async getStats(): Promise<{
    total: number;
    byLevel: Record<ForensicAnalysisRiskLevel, number>;
    avgRiskScore: number;
  }> {
    const total = await ForensicAnalysisModel.countDocuments().exec();

    const byLevelGroup = await ForensicAnalysisModel.aggregate([
      {
        $group: {
          _id: '$riskLevel',
          count: { $sum: 1 },
        },
      },
    ]).exec();

    const byLevel: Record<ForensicAnalysisRiskLevel, number> = {
      [ForensicAnalysisRiskLevel.CRITICAL]: 0,
      [ForensicAnalysisRiskLevel.HIGH]: 0,
      [ForensicAnalysisRiskLevel.MEDIUM]: 0,
      [ForensicAnalysisRiskLevel.LOW]: 0,
    };

    for (const item of byLevelGroup) {
      if (item._id in byLevel) {
        byLevel[item._id as ForensicAnalysisRiskLevel] = item.count;
      }
    }

    const avgResult = await ForensicAnalysisModel.aggregate([
      {
        $group: {
          _id: null,
          avgScore: { $avg: '$riskScore' },
        },
      },
    ]).exec();

    const avgRiskScore = avgResult[0]?.avgScore ?? 0;

    return { total, byLevel, avgRiskScore: Math.round(avgRiskScore * 10) / 10 };
  }
}

// Export singleton instance
export const forensicAnalysisRepository = new ForensicAnalysisRepository();

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
      .lean<IForensicAnalysis>()
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

  // Cascade deletes live in retentionReaper's CHILD_COLLECTIONS table — see the
  // note in ForensicErrorRepository for why this repo has no deleteByRunId.
}

// Export singleton instance
export const forensicAnalysisRepository = new ForensicAnalysisRepository();

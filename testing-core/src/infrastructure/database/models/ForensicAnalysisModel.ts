import { Schema, model, Types, Document } from 'mongoose';

/**
 * Risk levels for forensic analysis
 */
export enum ForensicAnalysisRiskLevel {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

const forensicAnalysisSchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Forensic run ID is required'],
      index: true,
    },
    rootCause: {
      type: String,
      required: [true, 'Root cause analysis is required'],
      trim: true,
    },
    riskScore: {
      type: Number,
      required: [true, 'Risk score is required'],
      min: 0,
      max: 100,
    },
    riskLevel: {
      type: String,
      required: [true, 'Risk level is required'],
      enum: Object.values(ForensicAnalysisRiskLevel),
      default: ForensicAnalysisRiskLevel.LOW,
    },
    recommendations: {
      type: [String],
      required: true,
      default: [],
    },
    // Additional metadata for context
    errorCount: {
      type: Number,
      default: 0,
    },
    apiFailureCount: {
      type: Number,
      default: 0,
    },
    criticalErrorCount: {
      type: Number,
      default: 0,
    },
    jsExceptionCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'forensic_analysis',
  }
);

// The only read shapes: findByRunId and the tenant-scoped findLatestForRuns, both
// filtering forensicRunId and sorting createdAt desc. Risk level/score are never
// queried across runs — a global leaderboard would be cross-tenant by nature.
forensicAnalysisSchema.index({ forensicRunId: 1, createdAt: -1 });

export interface IForensicAnalysis extends Document {
  forensicRunId: Types.ObjectId;
  rootCause: string;
  riskScore: number;
  riskLevel: ForensicAnalysisRiskLevel;
  recommendations: string[];
  errorCount: number;
  apiFailureCount: number;
  criticalErrorCount: number;
  jsExceptionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Helper to determine risk level from score
 */
export function determineRiskLevel(score: number): ForensicAnalysisRiskLevel {
  if (score >= 76) return ForensicAnalysisRiskLevel.CRITICAL;
  if (score >= 51) return ForensicAnalysisRiskLevel.HIGH;
  if (score >= 26) return ForensicAnalysisRiskLevel.MEDIUM;
  return ForensicAnalysisRiskLevel.LOW;
}

// Ordinal for clamping. INFO/unknown map to LOW so a volume of low-severity noise can
// never lift the level above what its worst finding actually is.
const RISK_LEVEL_ORDER: Record<ForensicAnalysisRiskLevel, number> = {
  [ForensicAnalysisRiskLevel.LOW]: 0,
  [ForensicAnalysisRiskLevel.MEDIUM]: 1,
  [ForensicAnalysisRiskLevel.HIGH]: 2,
  [ForensicAnalysisRiskLevel.CRITICAL]: 3,
};

/**
 * Clamp a score-derived risk level so it never exceeds the most-severe finding present.
 * A pile of MEDIUM findings saturates the numeric score into the HIGH band, which then
 * read as "HIGH risk" while every finding card was capped at MEDIUM. The level must not
 * claim a danger no single finding supports. `maxSeverity` is a finding-severity string
 * (CRITICAL/HIGH/MEDIUM/LOW/INFO); absent ⇒ no cap.
 */
export function capRiskLevelByMaxSeverity(
  level: ForensicAnalysisRiskLevel,
  maxSeverity?: string | null,
): ForensicAnalysisRiskLevel {
  const key = (maxSeverity ?? '').toUpperCase();
  const ceiling =
    key === 'CRITICAL' ? ForensicAnalysisRiskLevel.CRITICAL
    : key === 'HIGH' ? ForensicAnalysisRiskLevel.HIGH
    : key === 'MEDIUM' ? ForensicAnalysisRiskLevel.MEDIUM
    : key === 'LOW' || key === 'INFO' ? ForensicAnalysisRiskLevel.LOW
    : undefined;
  if (!ceiling) return level;
  return RISK_LEVEL_ORDER[level] > RISK_LEVEL_ORDER[ceiling] ? ceiling : level;
}

export const ForensicAnalysisModel = model<IForensicAnalysis>('ForensicAnalysis', forensicAnalysisSchema);

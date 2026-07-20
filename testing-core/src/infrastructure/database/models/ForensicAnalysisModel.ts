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

// Compound indexes for efficient querying
forensicAnalysisSchema.index({ forensicRunId: 1, createdAt: -1 });
forensicAnalysisSchema.index({ riskScore: -1 });
forensicAnalysisSchema.index({ riskLevel: 1, createdAt: -1 });

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

export const ForensicAnalysisModel = model<IForensicAnalysis>('ForensicAnalysis', forensicAnalysisSchema);

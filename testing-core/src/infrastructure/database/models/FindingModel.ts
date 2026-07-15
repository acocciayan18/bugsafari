// DEPRECATED: no longer written. Verified defects live in forensic_errors + session.forensicTrace; high-frequency telemetry is WebSocket-only.
import { Schema, model, Types, Document } from 'mongoose';
import { FindingType } from './FindingType.js';

const findingSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Session ID is required'],
      index: true,
    },
    timestamp: {
      type: Date,
      required: [true, 'Timestamp is required'],
      default: Date.now,
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Finding type is required'],
      enum: Object.values(FindingType),
    },
    meta: {
      type: Schema.Types.Mixed,
      required: [true, 'Meta data is required'],
      default: {},
    },
    linkedActionTraceIds: [
      {
        type: Types.ObjectId,
        ref: 'ActionTrace',
        required: false,
        default: [],
      },
    ],
    severity: {
      type: String,
      required: false,
      default: 'low',
      enum: ['low', 'medium', 'high', 'critical'],
    },
    description: {
      type: String,
      required: false,
      default: null,
      trim: true,
    },
    // Ordered, human-readable reproduction steps captured at crash time.
    // Persisted as a first-class field on the crash log (also lives inside `meta`).
    reproductionPlaybook: {
      type: [String],
      required: false,
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'findings',
  },
);

// Compound indexes for efficient querying
findingSchema.index({ sessionId: 1, timestamp: -1 });
findingSchema.index({ sessionId: 1, type: 1 });

export interface IFinding extends Document {
  sessionId: Types.ObjectId;
  timestamp: Date;
  type: FindingType;
  meta: Record<string, unknown>;
  linkedActionTraceIds: Types.ObjectId[];
  severity?: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  reproductionPlaybook?: string[];
}

export const FindingModel = model<IFinding>('Finding', findingSchema);

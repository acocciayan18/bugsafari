import { Schema, model, Types, Document } from 'mongoose';

// Full per-run network log (every request, incl. successful) — mirrors the
// live Network tab. Distinct from forensic_errors, which stores faults only.
const networkLogSchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Forensic run ID is required'],
      index: true,
    },
    timestamp: { type: Date, required: true },
    method: { type: String, required: true, default: 'GET' },
    url: { type: String, required: true },
    statusCode: { type: Number, required: false, default: null },
    durationMs: { type: Number, required: false, default: null },
    resourceType: { type: String, required: false, default: null },
    ok: { type: Boolean, required: true, default: true },
    message: { type: String, required: false, default: null },
    repeatCount: { type: Number, required: false, default: 1 },
  },
  {
    timestamps: true,
    collection: 'network_logs',
  },
);

networkLogSchema.index({ forensicRunId: 1, timestamp: 1 });

export interface INetworkLog extends Document {
  forensicRunId: Types.ObjectId;
  timestamp: Date;
  method: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  resourceType?: string;
  ok: boolean;
  message?: string;
  repeatCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export const NetworkLogModel = model<INetworkLog>('NetworkLog', networkLogSchema);

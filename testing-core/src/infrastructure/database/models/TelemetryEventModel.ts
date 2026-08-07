import { Schema, model, Types, Document } from 'mongoose';
import type { TelemetryMeta, TelemetryType } from '../../../../../shared/types.js';

// Full per-run telemetry event stream — the durable backing for reconnect replay
// beyond the capped in-memory buffer. One row per emitted TelemetryEvent, ordered
// by seq so a restore rebuilds the exact live order regardless of timestamp ties.
const telemetryEventSchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: true,
      index: true,
    },
    seq: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    type: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  {
    timestamps: true,
    collection: 'telemetry_events',
  },
);

telemetryEventSchema.index({ forensicRunId: 1, seq: 1 });

export interface ITelemetryEvent extends Document {
  forensicRunId: Types.ObjectId;
  seq: number;
  timestamp: Date;
  type: TelemetryType;
  meta: TelemetryMeta;
  createdAt: Date;
  updatedAt: Date;
}

export const TelemetryEventModel = model<ITelemetryEvent>('TelemetryEvent', telemetryEventSchema);

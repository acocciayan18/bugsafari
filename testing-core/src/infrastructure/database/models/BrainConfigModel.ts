import { Schema, model, Types, Document } from 'mongoose';

const brainConfigSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Session ID is required'],
      index: true,
    },
    // Denormalized owner so warm-start only ever reloads the tenant's OWN brain.
    userId: {
      type: Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    // Denormalized target URL so a run can load the latest brain for the same site (warm-start).
    targetUrl: {
      type: String,
      default: '',
      index: true,
    },
    capturedAt: {
      type: Date,
      required: [true, 'Capture timestamp is required'],
      default: Date.now,
      index: true,
    },
    source: {
      type: String,
      required: true,
      enum: ['start', 'runtime', 'finish', 'crash'],
      default: 'runtime',
    },
    bias: {
      type: Number,
      required: true,
      min: [-100, 'Bias cannot be less than -100'],
      max: [100, 'Bias cannot exceed 100'],
    },
    weights: {
      type: Map,
      of: Number,
      required: true,
      default: {},
      validate: {
        validator: (value: Map<string, number>) => value.size > 0,
        message: 'At least one weight must be captured',
      },
    },
  },
  {
    timestamps: true,
    collection: 'brain_configs',
  },
);

brainConfigSchema.index({ sessionId: 1, capturedAt: -1 });
brainConfigSchema.index({ userId: 1, targetUrl: 1, capturedAt: -1 });

export interface IBrainConfig extends Document {
  sessionId: Types.ObjectId;
  userId: Types.ObjectId;
  targetUrl: string;
  capturedAt: Date;
  source: 'start' | 'runtime' | 'finish' | 'crash';
  bias: number;
  weights: Map<string, number>;
}

export const BrainConfigModel = model<IBrainConfig>('BrainConfig', brainConfigSchema);

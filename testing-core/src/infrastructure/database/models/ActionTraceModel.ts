import { Schema, model, Types, Document } from 'mongoose';

const actionTraceSchema = new Schema(
  {
    sessionId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Session ID is required'],
      index: true,
    },
    findingId: {
      type: Types.ObjectId,
      ref: 'Finding',
      required: false,
      index: true,
      default: null,
    },
    timestamp: {
      type: Date,
      required: [true, 'Timestamp is required'],
      default: Date.now,
    },
    selector: {
      type: String,
      required: [true, 'Selector is required'],
      trim: true,
      minlength: [1, 'Selector cannot be empty'],
    },
    action: {
      type: String,
      required: [true, 'Action is required'],
      trim: true,
      minlength: [2, 'Action cannot be empty'],
      maxlength: [128, 'Action cannot exceed 128 characters'],
    },
    payload: {
      type: String,
      required: false,
      default: null,
      maxlength: [4000, 'Payload cannot exceed 4000 characters'],
    },
    score: {
      type: Number,
      required: false,
      default: null,
      min: [-1000, 'Score cannot be less than -1000'],
      max: [1000, 'Score cannot exceed 1000'],
    },
  },
  {
    timestamps: true,
    collection: 'action_traces',
  },
);

// Index for efficient querying by session and timestamp
actionTraceSchema.index({ sessionId: 1, timestamp: -1 });

export interface IActionTrace extends Document {
  sessionId: Types.ObjectId;
  findingId?: Types.ObjectId;
  timestamp: Date;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

export const ActionTraceModel = model<IActionTrace>('ActionTrace', actionTraceSchema);

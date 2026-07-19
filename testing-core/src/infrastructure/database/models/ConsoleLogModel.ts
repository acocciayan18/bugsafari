import { Schema, model, Types, Document } from 'mongoose';

// Full per-run console log (every level) — mirrors the live Console tab.
const consoleLogSchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Forensic run ID is required'],
      index: true,
    },
    timestamp: { type: Date, required: true },
    level: {
      type: String,
      required: true,
      enum: ['log', 'error', 'warning', 'info', 'debug', 'trace', 'notice'],
      default: 'log',
    },
    type: { type: String, required: false, default: 'log' },
    message: { type: String, required: true, default: '' },
    url: { type: String, required: false, default: null },
    line: { type: Number, required: false, default: null },
    column: { type: Number, required: false, default: null },
    stackTrace: { type: String, required: false, default: null },
  },
  {
    timestamps: true,
    collection: 'console_logs',
  },
);

consoleLogSchema.index({ forensicRunId: 1, timestamp: 1 });

export interface IConsoleLog extends Document {
  forensicRunId: Types.ObjectId;
  timestamp: Date;
  level: 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'notice';
  type: string;
  message: string;
  url?: string;
  line?: number;
  column?: number;
  stackTrace?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ConsoleLogModel = model<IConsoleLog>('ConsoleLog', consoleLogSchema);

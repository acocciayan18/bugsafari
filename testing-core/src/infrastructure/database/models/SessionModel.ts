import { Schema, model, Document } from 'mongoose';
import { SessionStatus } from './FindingType.js';

export interface ISessionConfig {
  maxDepth?: number;
  maxActions?: number;
  timeout?: number;
  headless?: boolean;
  allowedDomains?: string[];
}

export interface ISessionStats {
  actionsExecuted: number;
  findingsFound: number;
  pagesVisited: number;
  errorsEncountered: number;
  runtimeMs?: number;
}

const sessionSchema = new Schema(
  {
    targetUrl: {
      type: String,
      required: [true, 'Target URL is required'],
      trim: true,
      minlength: [8, 'Target URL is too short'],
      maxlength: [2048, 'Target URL is too long'],
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(SessionStatus),
      default: SessionStatus.RUNNING,
    },
    startedAt: {
      type: Date,
      required: [true, 'Start timestamp is required'],
      default: Date.now,
    },
    finishedAt: {
      type: Date,
      required: false,
      default: null,
    },
    savedManually: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    endedReason: {
      type: String,
      required: false,
      default: null,
      maxlength: [1500, 'Ended reason cannot exceed 1500 characters'],
    },
    findingCount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Finding count cannot be negative'],
    },
    actionTraceCount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Action trace count cannot be negative'],
    },
    brainSnapshotCount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Brain snapshot count cannot be negative'],
    },
    config: {
      type: {
        maxDepth: { type: Number, default: 5 },
        maxActions: { type: Number, default: 100 },
        timeout: { type: Number, default: 30000 },
        headless: { type: Boolean, default: true },
        allowedDomains: [{ type: String }],
      },
      required: false,
      default: { maxDepth: 5, maxActions: 100, timeout: 30000, headless: true, allowedDomains: [] },
    },
    stats: {
      type: {
        actionsExecuted: { type: Number, default: 0 },
        findingsFound: { type: Number, default: 0 },
        pagesVisited: { type: Number, default: 0 },
        errorsEncountered: { type: Number, default: 0 },
        runtimeMs: { type: Number, default: 0 },
      },
      required: false,
      default: {
        actionsExecuted: 0,
        findingsFound: 0,
        pagesVisited: 0,
        errorsEncountered: 0,
        runtimeMs: 0,
      },
    },
    error: {
      type: {
        message: { type: String, required: false },
        stackTrace: { type: String, required: false },
        timestamp: { type: Date, required: false },
      },
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'safari_sessions',
  },
);

// Indexes for efficient querying
sessionSchema.index({ status: 1, startedAt: -1 });
sessionSchema.index({ targetUrl: 1 });

export interface ISession extends Document {
  targetUrl: string;
  status: SessionStatus;
  startedAt: Date;
  finishedAt?: Date;
  savedManually: boolean;
  endedReason?: string;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshotCount: number;
  config: ISessionConfig;
  stats: ISessionStats;
  error?: {
    message?: string;
    stackTrace?: string;
    timestamp?: Date;
  };
}

export const SessionModel = model<ISession>('SafariSession', sessionSchema);

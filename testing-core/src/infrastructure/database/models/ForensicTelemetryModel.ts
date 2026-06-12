import { Schema, model, Document, Types } from 'mongoose';

/**
 * Error severity levels for forensic errors
 */
export enum ForensicTelemetryLevel {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

/**
 * Mongoose schema for forensic_telemetry collection
 * Stores runtime performance and environment information during autonomous testing
 */
const forensicTelemetrySchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Forensic run ID is required'],
      index: true,
    },
    browser: {
      type: String,
      required: [true, 'Browser name is required'],
      default: 'Chromium',
    },
    browserVersion: {
      type: String,
      required: [true, 'Browser version is required'],
    },
    browserEngine: {
      type: String,
      required: false,
      default: 'Blink',
    },
    operatingSystem: {
      type: String,
      required: [true, 'Operating system is required'],
    },
    platform: {
      type: String,
      required: false,
      default: 'unknown',
    },
    screenResolution: {
      type: String,
      required: false,
      default: null,
    },
    viewportWidth: {
      type: Number,
      required: false,
      default: 1440,
    },
    viewportHeight: {
      type: Number,
      required: false,
      default: 900,
    },
    memoryUsage: {
      type: Number,
      required: false,
      default: null,
    },
    cpuUsage: {
      type: Number,
      required: false,
      default: null,
    },
    executionDuration: {
      type: Number,
      required: false,
      default: 0,
    },
    requestsCount: {
      type: Number,
      required: false,
      default: 0,
    },
    pageCount: {
      type: Number,
      required: false,
      default: 0,
    },
    interactionCount: {
      type: Number,
      required: false,
      default: 0,
    },
    failureCount: {
      type: Number,
      required: false,
      default: 0,
    },
    loadTimes: {
      type: [
        {
          url: String,
          loadTime: Number,
          timestamp: Date,
        },
      ],
      required: false,
      default: [],
    },
    timestamp: {
      type: Date,
      required: [true, 'Timestamp is required'],
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'forensic_telemetry',
  },
);

// Indexes for efficient querying
forensicTelemetrySchema.index({ forensicRunId: 1, timestamp: -1 });

export interface IForensicTelemetry extends Document {
  forensicRunId: Types.ObjectId;
  browser: string;
  browserVersion: string;
  browserEngine: string;
  operatingSystem: string;
  platform: string;
  screenResolution: string | null;
  viewportWidth: number;
  viewportHeight: number;
  memoryUsage: number | null;
  cpuUsage: number | null;
  executionDuration: number;
  requestsCount: number;
  pageCount: number;
  interactionCount: number;
  failureCount: number;
  loadTimes: Array<{
    url: string;
    loadTime: number;
    timestamp: Date;
  }>;
  timestamp: Date;
}

export const ForensicTelemetryModel = model<IForensicTelemetry>('ForensicTelemetry', forensicTelemetrySchema);

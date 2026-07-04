import { Schema, model, Types, Document } from 'mongoose';

/**
 * Error types captured during autonomous testing
 */
export enum ForensicErrorType {
  CONSOLE_ERROR = 'CONSOLE_ERROR',
  CONSOLE_WARN = 'CONSOLE_WARN',
  JS_EXCEPTION = 'JS_EXCEPTION',
  UNHANDLED_REJECTION = 'UNHANDLED_REJECTION',
  API_FAILURE = 'API_FAILURE',
  NAVIGATION_FAILURE = 'NAVIGATION_FAILURE',
  TIMEOUT_FAILURE = 'TIMEOUT_FAILURE',
  SELECTOR_FAILURE = 'SELECTOR_FAILURE',
  INTERACTION_FAILURE = 'INTERACTION_FAILURE',
}

/**
 * Severity levels for errors
 */
export enum ForensicErrorSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

const forensicErrorSchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Forensic run ID is required'],
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Error type is required'],
      enum: Object.values(ForensicErrorType),
      index: true,
    },
    severity: {
      type: String,
      required: [true, 'Severity is required'],
      enum: Object.values(ForensicErrorSeverity),
      default: ForensicErrorSeverity.MEDIUM,
    },
    message: {
      type: String,
      required: [true, 'Error message is required'],
      trim: true,
    },
    stackTrace: {
      type: String,
      required: false,
      default: null,
    },
    url: {
      type: String,
      required: false,
      default: null,
    },
    // Additional metadata fields
    endpoint: {
      type: String,
      required: false,
      default: null,
    },
    method: {
      type: String,
      required: false,
      default: null,
    },
    statusCode: {
      type: Number,
      required: false,
      default: null,
    },
    responseText: {
      type: String,
      required: false,
      default: null,
    },
    filename: {
      type: String,
      required: false,
      default: null,
    },
    lineNumber: {
      type: Number,
      required: false,
      default: null,
    },
    columnNumber: {
      type: Number,
      required: false,
      default: null,
    },
    // Error source tracking
    selector: {
      type: String,
      required: false,
      default: null,
    },
    action: {
      type: String,
      required: false,
      default: null,
    },
    // Knowledge-base attribution (deterministic classification + scenario)
    bugClass: {
      type: String,
      required: false,
      default: null,
    },
    scenario: {
      type: String,
      required: false,
      default: null,
    },
    cwe: {
      type: String,
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'forensic_errors',
  }
);

// Compound indexes for efficient querying
forensicErrorSchema.index({ forensicRunId: 1, type: 1 });
forensicErrorSchema.index({ forensicRunId: 1, severity: 1 });
forensicErrorSchema.index({ forensicRunId: 1, timestamp: -1 });
forensicErrorSchema.index({ forensicRunId: 1, bugClass: 1 });

export interface IForensicError extends Document {
  forensicRunId: Types.ObjectId;
  type: ForensicErrorType;
  severity: ForensicErrorSeverity;
  message: string;
  stackTrace?: string;
  url?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseText?: string;
  filename?: string;
  lineNumber?: number;
  columnNumber?: number;
  selector?: string;
  action?: string;
  bugClass?: string;
  scenario?: string;
  cwe?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ForensicErrorModel = model<IForensicError>('ForensicError', forensicErrorSchema);

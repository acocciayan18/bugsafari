import { Schema, model, Document, Types } from 'mongoose';
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
  coveragePercentage?: number;
  maxActions?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Forensic Trace subdocuments - consolidated from SavedSafariModel
// ─────────────────────────────────────────────────────────────────────────────

export interface ICaughtBug {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  /** How many times this identical fault fired this session (dedup at save). */
  occurrences?: number;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
  /** Full stack trace captured live — preserved verbatim, never truncated. */
  stackTrace?: string;
  /** Per-finding human-actionable replication checklist (sequentially numbered upstream). */
  reproductionSteps?: string[];
  /** Minimized, replayable action timeline for THIS finding — drives per-finding regression replay. */
  actionSteps?: ActionStepTrace[];
  /** Deterministic classification + scenario/step attribution (knowledge base) plus verification verdict. */
  attribution?: {
    bugClass: string;
    cwe?: string;
    scenario?: string;
    testingType?: string;
    stepIndex?: number;
    origin?: string;
    confidence?: string;
    verificationStatus?: string;
    confidenceScore?: number;
    corroborated?: boolean;
  };
}

export interface IForensicTrace {
  finalBreadcrumbSteps: string[];
  caughtBugs: ICaughtBug[];
}

export type ActionStepActionType = 'click' | 'input' | 'navigation' | 'bypass';

export interface ActionStepTrace {
  stepNumber: number;
  timestamp: string;
  actionType: ActionStepActionType;
  selector: string;
  payloadText?: string;
  resultingStateHash: string;
}

export interface ISessionMetrics {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}

const sessionSchema = new Schema(
  {
    // User association - CRITICAL: Every session must belong to a user
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required — every session must belong to an authenticated user.'],
      index: true,
    },
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
        coveragePercentage: { type: Number, default: 0 },
        maxActions: { type: Number, default: 100 },
      },
      required: false,
      default: {
        actionsExecuted: 0,
        findingsFound: 0,
        pagesVisited: 0,
        errorsEncountered: 0,
        runtimeMs: 0,
        coveragePercentage: 0,
        maxActions: 100,
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
    // ─────────────────────────────────────────────────────────────────────────
    // Consolidated fields from SavedSafariModel for unified session history
    // ─────────────────────────────────────────────────────────────────────────
    // Note: executionDate aliases startedAt, timeElapsed aliases stats.runtimeMs
    // These fields allow backward compatibility with existing queries
    executionDate: {
      type: Date,
      default: () => new Date(),
      index: true,
    },
    timeElapsed: {
      type: Number,
      required: false,
      default: 0,
      min: [0, 'timeElapsed cannot be negative'],
    },
    metrics: {
      type: {
        totalActions: { type: Number, default: 0, min: 0 },
        totalBugsFound: { type: Number, default: 0, min: 0 },
        bugsByCategory: {
          type: Map,
          of: Number,
          default: {},
        },
      },
      required: false,
      default: { totalActions: 0, totalBugsFound: 0, bugsByCategory: {} },
    },
    forensicTrace: {
      type: {
        finalBreadcrumbSteps: {
          type: [String],
          default: [],
          validate: {
            validator: (steps: string[]) => steps.length <= 20,
            message: 'finalBreadcrumbSteps cannot exceed the 20-step limit.',
          },
        },
        caughtBugs: [{
          bugId: {
            type: String,
            default: () => new Types.ObjectId().toString(),
          },
          type: { type: String, default: '' },
          message: { type: String, default: '' },
          selector: { type: String, default: '' },
          // How many times this identical fault fired this session (dedup at save).
          occurrences: { type: Number, default: 1 },
          payloadUsed: { type: String, default: '' },
          advice: { type: String, default: '' },
          timestamp: { type: Date, default: Date.now },
          // Full stack trace + per-finding checklist — stored uncompressed for
          // exact parity with the live Error Tab.
          stackTrace: { type: String, default: '' },
          reproductionSteps: { type: [String], default: [] },
          // Minimized replayable timeline for THIS finding — the causal steps only,
          // consumed per-finding by the regression verifier.
          actionSteps: {
            type: [{
              stepNumber:         { type: Number, required: true, min: 1 },
              timestamp:          { type: String, required: true },
              actionType:         { type: String, required: true, enum: ['click', 'input', 'navigation', 'bypass'] },
              selector:           { type: String, required: true, default: '' },
              payloadText:        { type: String, required: false, default: null },
              resultingStateHash: { type: String, required: false, default: '' },
            }],
            default: [],
          },
          // Deterministic knowledge-base classification + scenario/step attribution,
          // plus the verification verdict (provenance, confidence, status, score).
          attribution: {
            type: {
              bugClass: { type: String, default: '' },
              cwe: { type: String, default: '' },
              scenario: { type: String, default: '' },
              testingType: { type: String, default: '' },
              stepIndex: { type: Number, default: null },
              origin: { type: String, default: null },
              confidence: { type: String, default: null },
              verificationStatus: { type: String, default: null },
              confidenceScore: { type: Number, default: null },
              corroborated: { type: Boolean, default: null },
            },
            required: false,
            default: null,
          },
        }],
      },
      required: false,
      default: { finalBreadcrumbSteps: [], caughtBugs: [] },
    },
    actionSteps: {
      type: [{
        stepNumber:         { type: Number, required: true, min: 1 },
        timestamp:          { type: String, required: true },
        actionType: {
          type: String,
          required: true,
          enum: ['click', 'input', 'navigation', 'bypass'],
        },
        selector:           { type: String, required: true, default: '' },
        payloadText:        { type: String, required: false, default: null },
        resultingStateHash: { type: String, required: false, default: '' },
      }],
      required: false,
      default: [],
      validate: {
        validator: (steps: unknown[]) => steps.length <= 20,
        message: 'actionSteps cannot exceed the 20-step limit.',
      },
    },
  },
  {
    timestamps: true,
    collection: 'sessions',
  },
);

// Indexes for efficient querying
sessionSchema.index({ status: 1, startedAt: -1 });
sessionSchema.index({ targetUrl: 1 });

export interface ISession extends Document {
  userId: Types.ObjectId;
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
  executionDate: Date;
  timeElapsed: number;
  metrics: ISessionMetrics;
  forensicTrace: IForensicTrace;
  actionSteps: ActionStepTrace[];
  error?: {
    message?: string;
    stackTrace?: string;
    timestamp?: Date;
  };
}

export const SessionModel = model<ISession>('SafariSession', sessionSchema);

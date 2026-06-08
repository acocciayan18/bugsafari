import mongoose, { Schema, type Document } from 'mongoose';

// ─────────────────────────────────────────────────────────────────────────────
// ISavedSafari — TypeScript interface contract
// Collection target: 'savedsafaris'
// Relational parent: 'users'
// ─────────────────────────────────────────────────────────────────────────────

export interface ICaughtBug {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
}

export interface IForensicTrace {
  finalBreadcrumbSteps: string[];
  caughtBugs: ICaughtBug[];
}

export interface IMetrics {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}

export interface ISavedSafari extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  targetUrl: string;
  executionDate: Date;
  timeElapsed: number;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED';
  metrics: IMetrics;
  forensicTrace: IForensicTrace;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-document schema: CaughtBug
// Each entry receives a unique ObjectId-derived bugId on creation.
// ─────────────────────────────────────────────────────────────────────────────

const CaughtBugSchema = new Schema<ICaughtBug>(
  {
    bugId: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    type: { type: String, default: '' },
    message: { type: String, default: '' },
    selector: { type: String, default: '' },
    payloadUsed: { type: String, default: '' },
    advice: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }, // Sub-documents use bugId as the canonical identifier
);

// ─────────────────────────────────────────────────────────────────────────────
// Sub-document schema: ForensicTrace
// Holds the 20-step circular action breadcrumb buffer and the full bug list.
// ─────────────────────────────────────────────────────────────────────────────

const ForensicTraceSchema = new Schema<IForensicTrace>(
  {
    finalBreadcrumbSteps: {
      type: [String],
      default: [],
      validate: {
        validator: (steps: string[]) => steps.length <= 20,
        message: 'finalBreadcrumbSteps cannot exceed the 20-step circular buffer capacity.',
      },
    },
    caughtBugs: {
      type: [CaughtBugSchema],
      default: [],
    },
  },
  { _id: false },
);

// ─────────────────────────────────────────────────────────────────────────────
// Sub-document schema: Metrics
// ─────────────────────────────────────────────────────────────────────────────

const MetricsSchema = new Schema<IMetrics>(
  {
    totalActions: { type: Number, default: 0, min: 0 },
    totalBugsFound: { type: Number, default: 0, min: 0 },
    bugsByCategory: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { _id: false },
);

// ─────────────────────────────────────────────────────────────────────────────
// Root schema: SavedSafari
// Collection: 'savedsafaris'
// ─────────────────────────────────────────────────────────────────────────────

const SavedSafariSchema = new Schema<ISavedSafari>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',      // Relational link to the 'users' collection via the User model
      required: [true, 'userId is required — every safari run must belong to a registered user.'],
      index: true,
    },
    targetUrl: {
      type: String,
      required: [true, 'targetUrl is required.'],
      trim: true,
      minlength: [4, 'targetUrl is too short to be a valid URL.'],
      maxlength: [2048, 'targetUrl cannot exceed 2048 characters.'],
    },
    executionDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    timeElapsed: {
      type: Number,
      required: [true, 'timeElapsed is required.'],
      min: [0, 'timeElapsed cannot be negative.'],
    },
    status: {
      type: String,
      required: [true, 'status is required.'],
      enum: {
        values: ['COMPLETED', 'CRASHED', 'HALTED'],
        message: 'status must be one of: COMPLETED, CRASHED, HALTED.',
      },
    },
    metrics: {
      type: MetricsSchema,
      default: () => ({ totalActions: 0, totalBugsFound: 0, bugsByCategory: {} }),
    },
    forensicTrace: {
      type: ForensicTraceSchema,
      default: () => ({ finalBreadcrumbSteps: [], caughtBugs: [] }),
    },
  },
  {
    timestamps: true,
    collection: 'savedsafaris', // Explicit collection name — overrides Mongoose pluralisation
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Compound indexes for high-performance dashboard queries
// ─────────────────────────────────────────────────────────────────────────────

// Primary history query: filter by user, sort newest-first
SavedSafariSchema.index({ userId: 1, executionDate: -1 });

// Secondary: filter by user + status (e.g. "show me all CRASHED runs")
SavedSafariSchema.index({ userId: 1, status: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// Model export
// ─────────────────────────────────────────────────────────────────────────────

export const SavedSafari = mongoose.model<ISavedSafari>(
  'SavedSafari',
  SavedSafariSchema,
);
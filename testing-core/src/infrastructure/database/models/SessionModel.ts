import { Schema, model, Document, Types } from 'mongoose';
import type { ActionOutcome, ConstraintBypassDetail, InfiltrationProfileId, PersistedVerification, ReplayMacro, RunTerminationOutcome, StateFingerprint, TestingTypeId } from '../../../../../shared/types.js';
import { SessionStatus } from './FindingType.js';
import { generateRunCode } from '../runCodeGenerator.js';
import { RUN_CODE_REGEX } from '../../../../../shared/runCode.js';
import { ACTION_TRACE_CAPACITY } from '../../monitoring/reproductionPlaybookStore.js';

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
  /** Raw selector — internal only (replay/dedup); never rendered in the report. */
  selector: string;
  /** Human name of the culprit control, shown in the report instead of the selector. */
  elementLabel?: string;
  /** How many times this identical fault fired this session (dedup at save). */
  occurrences?: number;
  payloadUsed: string;
  advice: string;
  /** LLM-generated remediation, persisted on demand from the report — survives refresh. */
  aiAdvice?: string;
  timestamp: Date;
  /** Backend-classified severity (CRITICAL/HIGH/MEDIUM/LOW/INFO) — drives the report badge. */
  severity?: string;
  /** Full stack trace captured live — preserved verbatim, never truncated. */
  stackTrace?: string;
  /** Top frames resolved to original source via the target's source maps (best-effort). */
  resolvedStackTrace?: string;
  /** Per-finding human-actionable replication checklist (sequentially numbered upstream). */
  reproductionSteps?: string[];
  /** Minimized, replayable action timeline for THIS finding — drives per-finding regression replay. */
  actionSteps?: ActionStepTrace[];
  /** Client-state snapshot restored before replay so cross-page-state faults reproduce. */
  stateFingerprint?: StateFingerprint;
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
    /** Routing-tree reason code behind the promotion (see shared telemetryRouting). */
    routingReason?: string;
  };
  /** Structured constraint-bypass evidence — present only on CLIENT_SIDE_CONSTRAINT_BYPASS. */
  bypass?: ConstraintBypassDetail;
  /** Last Verify-Fix replay verdict, persisted on demand so it survives a report refresh. */
  verification?: PersistedVerification | null;
}

export interface IForensicTrace {
  finalBreadcrumbSteps: string[];
  caughtBugs: ICaughtBug[];
}

export type ActionStepActionType = 'click' | 'input' | 'navigation' | 'submit' | 'bypass' | 'macro';

export interface ActionStepTrace {
  stepNumber: number;
  timestamp: string;
  actionType: ActionStepActionType;
  selector: string;
  /** Human-readable element label (text/aria/name/id) — shown instead of the raw selector. */
  label?: string;
  /** Plain-English control type (button, link, field…) read by the step narrator. */
  elementKind?: string;
  payloadText?: string;
  resultingStateHash: string;
  /** Real execution time of this step in ms (measured in the executor). */
  durationMs?: number;
  /** Identical rapid repeats collapsed into this step (>1 ⇒ "repeated N times"). */
  repeatCount?: number;
  /** Validation attributes stripped on a bypass step (required, maxlength, pattern…). */
  strippedAttributes?: string[];
  /** Count of elements a bypass step affected. */
  affectedCount?: number;
  /** True ⇒ mask the payload value in step text (auth/password fields). */
  redactValue?: boolean;
  /** Page URL the step ran on — rendered as the destination of a navigation step. */
  url?: string;
  /** Human name of the UI container the step ran in — frames WHERE the step happened. */
  containerLabel?: string;
  /** Container kind (modal, dialog, tab, panel, section, form…). */
  containerKind?: string;
  /** What was observed right after the step (navigation, HTTP status, DOM change). */
  outcome?: ActionOutcome;
  /** Present only on a 'macro' step — the re-expandable stress-scenario descriptor. */
  macro?: ReplayMacro;
}

export interface ISessionMetrics {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}

// Re-expandable stress-scenario descriptor stored on a 'macro' action step.
const MacroSchemaField = {
  scenario: { type: String, default: '' },
  params: {
    count:       { type: Number, required: false, default: null },
    width:       { type: Number, required: false, default: null },
    height:      { type: Number, required: false, default: null },
    repetitions: { type: Number, required: false, default: null },
    selectors:   { type: [String], required: false, default: undefined },
    // Human descriptors of the burst elements, index-aligned with `selectors`.
    targets:     { type: [{ label: String, kind: String }], required: false, default: undefined },
  },
  summary: { type: String, default: '' },
};

// One replayable step of the reproduction timeline. Shared by the session-global
// timeline and each finding's minimized timeline so both persist identical fields.
const ActionStepSchemaFields = {
  stepNumber:         { type: Number, required: true, min: 1 },
  timestamp:          { type: String, required: true },
  actionType:         { type: String, required: true, enum: ['click', 'input', 'navigation', 'submit', 'bypass', 'macro'] },
  selector:           { type: String, required: true, default: '' },
  label:              { type: String, required: false, default: null },
  elementKind:        { type: String, required: false, default: null },
  payloadText:        { type: String, required: false, default: null },
  resultingStateHash: { type: String, required: false, default: '' },
  durationMs:         { type: Number, required: false, default: null },
  repeatCount:        { type: Number, required: false, default: null },
  strippedAttributes: { type: [String], required: false, default: undefined },
  affectedCount:      { type: Number, required: false, default: null },
  redactValue:        { type: Boolean, required: false, default: null },
  url:                { type: String, required: false, default: null },
  containerLabel:     { type: String, required: false, default: null },
  containerKind:      { type: String, required: false, default: null },
  outcome: {
    type: {
      navigatedTo: { type: String, required: false, default: null },
      httpStatus:  { type: Number, required: false, default: null },
      domChanged:  { type: Boolean, required: false, default: null },
    },
    required: false,
    default: null,
  },
  macro:              { type: MacroSchemaField, required: false, default: null },
};

// Bounded client-state snapshot restored before regression replay.
const StateFingerprintSchemaField = {
  localStorage:   { type: Schema.Types.Mixed, default: null },
  sessionStorage: { type: Schema.Types.Mixed, default: null },
  cookies: {
    type: [{ name: String, value: String, domain: String, path: String }],
    required: false,
    default: undefined,
  },
};

const sessionSchema = new Schema(
  {
    // Public, human-readable session identifier (RUN-XXXXXX). The user-facing
    // canonical id; `_id` stays the internal DB key + forensic correlation key.
    // Sparse-unique so legacy docs load until the backfill assigns one.
    runId: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      uppercase: true,
      match: [RUN_CODE_REGEX, 'runId must be RUN- followed by 6-12 uppercase hex characters'],
      default: generateRunCode,
    },
    // User association - CRITICAL: Every session must belong to a user
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required — every session must belong to an authenticated user.'],
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
    },
    // Soft-delete lifecycle. Null on legacy docs (treated as active). archivedAt
    // parks a saved run out of the working list but keeps it fully recoverable;
    // deletedAt is the Trash tombstone the retention reaper eventually purges.
    archivedAt: {
      type: Date,
      required: false,
      default: null,
    },
    deletedAt: {
      type: Date,
      required: false,
      default: null,
    },
    endedReason: {
      type: String,
      required: false,
      default: null,
      maxlength: [1500, 'Ended reason cannot exceed 1500 characters'],
    },
    // Precise termination taxonomy behind the coarse `status`. Optional so
    // sessions written before it existed still load and render.
    outcome: {
      type: String,
      required: false,
      default: null,
    },
    // Infiltration profile this run actually executed, plus the testing-type
    // categories its gate enforced. Without these a saved safari could not say
    // which run configuration produced its findings. Optional — sessions written
    // before the fields existed still load.
    infiltrationProfile: {
      type: String,
      required: false,
      default: null,
    },
    activeTestingTypes: {
      type: [String],
      required: false,
      default: undefined,
    },
    executionTimeboxMs: {
      type: Number,
      required: false,
      default: null,
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
            validator: (steps: string[]) => steps.length <= ACTION_TRACE_CAPACITY,
            message: `finalBreadcrumbSteps cannot exceed the ${ACTION_TRACE_CAPACITY}-step limit.`,
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
          elementLabel: { type: String, default: '' },
          // How many times this identical fault fired this session (dedup at save).
          occurrences: { type: Number, default: 1 },
          payloadUsed: { type: String, default: '' },
          advice: { type: String, default: '' },
          // On-demand LLM remediation, persisted from the report so it survives refresh.
          aiAdvice: { type: String, default: '' },
          severity: { type: String, default: null },
          timestamp: { type: Date, default: Date.now },
          // Full stack trace + per-finding checklist — stored uncompressed for
          // exact parity with the live Error Tab.
          stackTrace: { type: String, default: '' },
          resolvedStackTrace: { type: String, default: '' },
          reproductionSteps: { type: [String], default: [] },
          // Minimized replayable timeline for THIS finding — the causal steps only,
          // consumed per-finding by the regression verifier.
          actionSteps: {
            type: [ActionStepSchemaFields],
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
              // Why the shared routing tree promoted this to a finding.
              routingReason: { type: String, default: null },
            },
            required: false,
            default: null,
          },
          // Client-state snapshot restored before regression replay (cross-page faults).
          stateFingerprint: { type: StateFingerprintSchemaField, required: false, default: null },
          // Structured constraint-bypass evidence — present only on CLIENT_SIDE_CONSTRAINT_BYPASS.
          bypass: {
            type: {
              element: { type: String, default: '' },
              payload: { type: String, default: '' },
              strippedAttribute: { type: String, default: '' },
              endpoint: { type: String, default: '' },
              method: { type: String, default: '' },
              status: { type: Number, default: 0 },
            },
            required: false,
            default: null,
          },
          // Last Verify-Fix replay verdict — persisted on demand so it survives a report refresh.
          verification: {
            type: {
              ok: { type: Boolean, default: false },
              verdict: { type: String, default: '' },
              reason: { type: String, default: '' },
              bugClass: { type: String, default: '' },
              stepsReplayed: { type: Number, default: 0 },
              stepStats: {
                type: {
                  total: { type: Number, default: 0 },
                  executed: { type: Number, default: 0 },
                  skipped: { type: Number, default: 0 },
                  failed: { type: Number, default: 0 },
                  finalStepExecuted: { type: Boolean, default: false },
                },
                default: null,
              },
              matchedSignals: {
                type: [{ faultType: String, message: String, statusCode: Number, url: String }],
                default: [],
              },
              otherSignals: {
                type: [{ faultType: String, message: String, statusCode: Number, url: String }],
                default: [],
              },
              timelineSource: { type: String, default: '' },
              summary: { type: String, default: '' },
              durationMs: { type: Number, default: 0 },
              error: { type: String, default: '' },
              verifiedAt: { type: String, default: '' },
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
      type: [ActionStepSchemaFields],
      required: false,
      default: [],
      validate: {
        validator: (steps: unknown[]) => steps.length <= ACTION_TRACE_CAPACITY,
        message: `actionSteps cannot exceed the ${ACTION_TRACE_CAPACITY}-step limit.`,
      },
    },
    // Distinct routes/URLs visited this run — session-global page set for history context.
    visitedRoutes: {
      type: [String],
      default: [],
      validate: {
        validator: (routes: string[]) => routes.length <= 500,
        message: 'visitedRoutes cannot exceed the 500-route limit.',
      },
    },
    // On-demand session-level AI Insights, persisted from the report so they survive
    // refresh. Absent until the operator generates one; deterministic analysis is the fallback.
    aiInsights: {
      type: {
        rootCause: { type: String, default: '' },
        recommendations: { type: [String], default: [] },
      },
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'sessions',
  },
);

// Indexes for efficient querying. The userId compounds cover single-field userId
// lookups by prefix, so no standalone userId/savedManually/executionDate index.
sessionSchema.index({ userId: 1, savedManually: 1, startedAt: -1 });
sessionSchema.index({ userId: 1, startedAt: -1 });
// Trash purge scan: only tombstoned docs are indexed, so the reaper's cutoff
// query never walks the live/archived working set.
sessionSchema.index(
  { deletedAt: 1 },
  { name: 'trashed_sessions', partialFilterExpression: { deletedAt: { $type: 'date' } } },
);
sessionSchema.index({ status: 1, startedAt: -1 });
sessionSchema.index({ targetUrl: 1 });

// Retention: abandoned (never explicitly saved) sessions expire automatically.
// The partial filter means flipping savedManually to true drops the doc out of
// the index, so saved history is never expired. Child forensic docs are swept
// separately by retentionReaper — a TTL delete does not cascade.
const DEFAULT_UNSAVED_SESSION_TTL_SECONDS = 86_400;
const MIN_UNSAVED_SESSION_TTL_SECONDS = 300;

function readUnsavedSessionTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.BUGSAFARI_UNSAVED_SESSION_TTL_SECONDS ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_UNSAVED_SESSION_TTL_SECONDS;
  return Math.max(MIN_UNSAVED_SESSION_TTL_SECONDS, parsed);
}

export const UNSAVED_SESSION_TTL_SECONDS = readUnsavedSessionTtlSeconds();

sessionSchema.index(
  { startedAt: 1 },
  {
    name: 'unsaved_sessions_ttl',
    expireAfterSeconds: UNSAVED_SESSION_TTL_SECONDS,
    partialFilterExpression: { savedManually: false },
  },
);

export interface ISession extends Document {
  runId?: string;
  userId: Types.ObjectId;
  targetUrl: string;
  status: SessionStatus;
  startedAt: Date;
  finishedAt?: Date;
  savedManually: boolean;
  /** Set while parked in the Archive; null when active. */
  archivedAt?: Date | null;
  /** Trash tombstone; null when not soft-deleted. Purged by the retention reaper. */
  deletedAt?: Date | null;
  endedReason?: string;
  outcome?: RunTerminationOutcome;
  /** Infiltration profile this run executed; absent on sessions predating the field. */
  infiltrationProfile?: InfiltrationProfileId;
  /** Testing-type categories the run's ScenarioGate enforced. */
  activeTestingTypes?: TestingTypeId[];
  /** Operator-selected execution timebox (ms); absent on sessions predating the field. */
  executionTimeboxMs?: number;
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
  visitedRoutes: string[];
  aiInsights?: { rootCause: string; recommendations: string[] };
  error?: {
    message?: string;
    stackTrace?: string;
    timestamp?: Date;
  };
}

export const SessionModel = model<ISession>('SafariSession', sessionSchema);

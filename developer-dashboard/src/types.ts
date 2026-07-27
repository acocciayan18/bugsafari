// Re-export shared telemetry types for the dashboard.
// This keeps front-end code decoupled from shared folder structure.

export type {
  ActionBreadcrumb,
  ActionRecord,
  ActionType,
  ForensicCrashReport,
  IncidentReport,
  ConstraintBypassDetail,
  FindingAttribution,
  TelemetryEvent,
  TelemetryType,
  TelemetryMeta,
  ExceptionDetails,
  // Dedicated WCAG accessibility stream
  AccessibilityFinding,
  A11yImpact,
  SemanticRole,
  BoundingBox,
  DiscoveredElement,
  IntelligentDiagnosis,
  // OptimizationSettings now shared between backend and frontend
  OptimizationSettings,
  defaultOptimizationSettings,
  // Testing Type Selector (operator-gated scenario matrix)
  TestingTypeId,
  TestingTypeOption,
  ExplorationRunConfig,
  // Ephemeral target-app credentials (never persisted client- or server-side)
  TargetAuthConfig,
  // Unified Infiltration Profiles (operator-facing preset layer)
  InfiltrationProfileId,
  InfiltrationProfileOption,
  // Automated Regression Verification (Verify Fix)
  RegressionVerdict,
  VerifyFixRequest,
  VerifyFixResult,
  VerifyFixReason,
  VerifyFixProgress,
  VerifyFixPhase,
  RegressionSignal,
  ReplayStepStats,
  // In-run reproduction confirmation (patches a streamed finding's confidence)
  ReproductionVerdict,
  // Session recovery & reconnection
  ActiveSessionSnapshot,
  TimeSyncPayload,
  SessionAttachRequest,
  SessionAttachAck,
  RunLifecycleStatus,
  SessionOwnerType,
  // How and why a run ended
  RunTerminationOutcome,
  StopReason,
  // Redis execution queue
  QueueUpdate,
  QueueSubscribeRequest,
  QueueJobState,
} from '../../shared/types.js';

// Value re-exports (runtime constants used to render the selector + defaults).
export {
  TESTING_TYPE_CATALOG,
  ALL_TESTING_TYPE_IDS,
  INFILTRATION_PROFILE_CATALOG,
  DEFAULT_INFILTRATION_PROFILE,
  resolveInfiltrationProfile,
  VERIFY_FIX_EVENT,
  VERIFY_FIX_PROGRESS_EVENT,
  SESSION_ATTACH_EVENT,
  SESSION_SNAPSHOT_EVENT,
  TIME_SYNC_EVENT,
  ACCESSIBILITY_EVENT,
  ACCESSIBILITY_BANNER_THRESHOLD,
  REPRODUCTION_VERDICT_EVENT,
  QUEUE_SUBSCRIBE_EVENT,
  QUEUE_UPDATE_EVENT,
  TERMINATION_COPY,
  describeTermination,
  isCleanTermination,
} from '../../shared/types.js';

// Local binding (the re-export above does not bring the name into local scope).
import type { ActionOutcome, ConstraintBypassDetail, FindingAttribution, ReplayMacro, RunTerminationOutcome } from '../../shared/types.js';

// Browser console contract lives once in shared/types/console.ts — re-exported here
// so frontend consumers keep importing it from the local barrel without shadowing it.
export type { BrowserConsoleLevel, BrowserConsoleMessage } from '../../shared/types.js';

export interface SessionHistoryEntry {
  id: string;
  // Public human-readable run code (RUN-XXXXXX); absent on legacy rows saved before it existed.
  runId?: string;
  targetUrl: string;
  status: 'Running' | 'Completed' | 'Crashed' | 'Stopped' | 'TimedOut' | 'Halted' | 'Abandoned';
  startedAt: string;
  finishedAt?: string;
  endedReason?: string;
  /** Precise termination taxonomy. Absent on sessions saved before it was tracked. */
  outcome?: RunTerminationOutcome;
  savedManually: boolean;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshots: number;
  runtimeMs?: number;
  coveragePercentage?: number;
  maxActions?: number;
  pagesVisited?: number;
}

// ─────────────────────────────────────────────────────────────
//  FORENSIC INSPECTION REPORT TYPES
// Mirrors the `report` object returned by GET /api/forensic/report/:sessionId
// (testing-core/src/presentation/api/registerRoutes.ts). Only the fields the
// inspection drawer renders are modelled here.
// ─────────────────────────────────────────────────────────────

export interface ForensicActionStep {
  stepNumber: number;
  timestamp: string;
  actionType: string;
  selector: string;
  payloadText?: string;
  resultingStateHash: string;
  /** Real execution time of this step in ms (measured in the engine). */
  durationMs?: number;
  /** Present only on a 'macro' step — the re-expandable stress-scenario descriptor. */
  macro?: ReplayMacro;
  /** Human-readable element label, preferred over the raw selector in step text. */
  elementLabel?: string;
  /** Persisted label field name on saved reports (backend `ActionStepTrace.label`). */
  label?: string;
  /** Plain-English control type (button, link, field…) used to name the target. */
  elementKind?: string;
  /** Identical rapid repeats collapsed into this step (>1 ⇒ "repeated N times"). */
  repeatCount?: number;
  /** Validation attributes stripped on a bypass step (required, maxlength, pattern, …). */
  strippedAttributes?: string[];
  /** Count of elements a bypass step affected. */
  affectedCount?: number;
  /** True ⇒ mask the payload value in step text (auth/password fields). */
  redactValue?: boolean;
  /** Page URL the step ran on — the destination shown on a navigation step. */
  url?: string;
  /** What was observed right after the step (navigation, HTTP status, DOM change). */
  outcome?: ActionOutcome;
}

// Full per-run network row (every request, incl. successful) — mirrors live Network tab.
export interface ForensicNetworkLog {
  timestamp: string;
  method: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  resourceType?: string;
  ok: boolean;
  message?: string;
  repeatCount?: number;
}

// Full per-run console row (every level) — mirrors live Console tab.
export interface ForensicConsoleLog {
  timestamp: string;
  level: 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'notice';
  type: string;
  message: string;
  url?: string;
  line?: number;
  column?: number;
  stackTrace?: string;
}

export interface ForensicReportError {
  id?: string;
  type?: string;
  severity?: string;
  message?: string;
  stackTrace?: string;
  url?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  selector?: string;
  action?: string;
  // Deterministic knowledge-base classification + scenario attribution.
  bugClass?: string;
  scenario?: string;
  cwe?: string;
  createdAt?: string;
}

export interface ForensicCaughtBug {
  bugId: string;
  type: string;
  message: string;
  /** Raw selector — internal only (replay/dedup); never rendered. */
  selector: string;
  /** Human name of the culprit control, rendered in place of the selector. */
  elementLabel?: string;
  /** How many times this identical fault fired this session (deduped at save). */
  occurrences?: number;
  payloadUsed: string;
  advice: string;
  timestamp: string;
  /** Backend-classified severity (CRITICAL/HIGH/MEDIUM/LOW/INFO). */
  severity?: string;
  /** Full stack trace captured live, preserved verbatim into history. */
  stackTrace?: string;
  /** Top frames resolved to original source via the target's source maps (best-effort). */
  resolvedStackTrace?: string;
  /** Per-finding, human-actionable numbered replication checklist. */
  reproductionSteps?: string[];
  /** Per-finding minimized, replayable action trace — the same timeline Verify Fix replays. */
  actionSteps?: ForensicActionStep[];
  /** Deterministic knowledge-base classification + scenario/step attribution. */
  attribution?: FindingAttribution;
  /** Structured constraint-bypass evidence — present only on CLIENT_SIDE_CONSTRAINT_BYPASS. */
  bypass?: ConstraintBypassDetail;
}

export interface ForensicReportResponse {
  runId: string;
  url: string;
  date: string;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED' | string;
  /** Precise termination taxonomy; absent on reports predating it. */
  outcome?: RunTerminationOutcome;
  endedReason?: string;
  coverage: number;
  duration: number; // milliseconds
  riskScore: number;
  findings: {
    vulnerabilities?: number;
    securityIssues?: number;
    functionalFailures?: number;
    totalBugsFound: number;
    bugsByCategory: Record<string, number>;
  };
  errorLogs: {
    consoleErrors?: number;
    apiFailures?: number;
    jsExceptions?: number;
    totalErrors: number;
    errors: ForensicReportError[];
  };
  aiAnalysis: {
    rootCause?: string;
    recommendations?: string[];
    riskLevel?: string;
  } | null;
  metrics: {
    totalActions: number;
    totalBugsFound: number;
    bugsByCategory: Record<string, number>;
  };
  forensicTrace: {
    finalBreadcrumbSteps: string[];
    caughtBugs: ForensicCaughtBug[];
  };
  actionSteps: ForensicActionStep[];
  /** Full network log (all requests) — mirrors the live Network tab. */
  networkLog?: ForensicNetworkLog[];
  /** Full console log (all levels) — mirrors the live Console tab. */
  consoleLog?: ForensicConsoleLog[];
  /** Distinct routes/URLs visited this run — session-global page set. */
  visitedRoutes?: string[];
  /** Count of distinct pages visited (= visitedRoutes.length). */
  pagesVisited?: number;
}

// ─────────────────────────────────────────────────────────────
//  USER SETTINGS TYPES
// ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  createdAt?: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  autoSave: boolean;
}

export interface PasswordChangeForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ProfileUpdateData {
  name?: string;
  email?: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';




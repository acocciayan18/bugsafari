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
  // Navigation boundary lock mode (operator-facing single choice)
  BoundaryLockMode,
  // Execution time-limit (operator-selectable timebox presets)
  TestDurationId,
  TestDurationOption,
  // Automated Regression Verification (Verify Fix)
  RegressionVerdict,
  VerifyFixRequest,
  VerifyFixResult,
  PersistedVerification,
  VerifyFixReason,
  VerifyFixProgress,
  VerifyFixPhase,
  RegressionSignal,
  ReplayStepStats,
  // In-run reproduction confirmation (patches a streamed finding's confidence)
  ReproductionVerdict,
  // In-run verdict upgrade (patches a streamed finding's severity/message in place)
  FindingUpgrade,
  // In-run authoritative repeat-count update (patches a streamed finding's ×N by bugId)
  FindingOccurrencePatch,
  // Session recovery & reconnection
  ActiveSessionSnapshot,
  TimeSyncPayload,
  SessionAttachRequest,
  SessionAttachAck,
  RunLifecycleStatus,
  SessionOwnerType,
  // Saved-history lifecycle bucket (Active/Archived/Trash)
  SessionHistoryState,
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
  DEFAULT_BOUNDARY_LOCK_MODE,
  boundaryModeToFlags,
  boundaryModeFromFlags,
  TEST_DURATION_PRESETS,
  DEFAULT_TEST_DURATION_ID,
  durationIdToFlags,
  durationIdFromFlags,
  VERIFY_FIX_EVENT,
  VERIFY_FIX_PROGRESS_EVENT,
  SESSION_ATTACH_EVENT,
  SESSION_SNAPSHOT_EVENT,
  TIME_SYNC_EVENT,
  ACCESSIBILITY_EVENT,
  ACCESSIBILITY_BANNER_THRESHOLD,
  REPRODUCTION_VERDICT_EVENT,
  FINDING_UPGRADE_EVENT,
  FINDING_OCCURRENCE_EVENT,
  QUEUE_SUBSCRIBE_EVENT,
  QUEUE_UPDATE_EVENT,
  TERMINATION_COPY,
  describeTermination,
  isCleanTermination,
  // Saved-history importance gate (drives typed confirmation on permanent delete)
  isImportantSession,
  IMPORTANT_FINDING_THRESHOLD,
} from '../../shared/types.js';

// Local binding (the re-export above does not bring the name into local scope).
import type { ActionOutcome, ConstraintBypassDetail, FindingAttribution, InfiltrationProfileId, PersistedVerification, ReplayMacro, RunTerminationOutcome, SessionHistoryState } from '../../shared/types.js';

// Browser console contract lives once in shared/types/console.ts — re-exported here
// so frontend consumers keep importing it from the local barrel without shadowing it.
export type { BrowserConsoleLevel, BrowserConsoleMessage } from '../../shared/types.js';

// Network-status contract (phase enum + engine action markers) shared with the backend.
export type { NetworkPhase } from '../../shared/types.js';
export { NETWORK_ACTION, NETWORK_ACTION_MARKERS } from '../../shared/types.js';

export interface SessionHistoryEntry {
  id: string;
  // Public human-readable run code (RUN-XXXXXX); absent on legacy rows saved before it existed.
  runId?: string;
  targetUrl: string;
  status: 'Running' | 'Completed' | 'Crashed' | 'Stopped' | 'TimedOut' | 'Halted' | 'Abandoned' | 'EngineError';
  startedAt: string;
  finishedAt?: string;
  endedReason?: string;
  /** Precise termination taxonomy. Absent on sessions saved before it was tracked. */
  outcome?: RunTerminationOutcome;
  /** Infiltration profile the run executed. Absent on sessions saved before it was tracked. */
  infiltrationProfile?: InfiltrationProfileId;
  savedManually: boolean;
  /** History bucket this row belongs to (Active/Archived/Trash). Absent on old servers → active. */
  state?: SessionHistoryState;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshots: number;
  runtimeMs?: number;
  maxActions?: number;
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
  /** Human name of the UI container the step ran in — frames WHERE the step happened. */
  containerLabel?: string;
  /** Container kind (modal, dialog, tab, panel, section, form…). */
  containerKind?: string;
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
  errorText?: string;
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
  /** On-demand LLM remediation persisted from the report — takes precedence over `advice` when present. */
  aiAdvice?: string;
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
  /** Last Verify-Fix replay verdict, persisted from the report — seeds the card's initial status. */
  verification?: PersistedVerification;
}

export interface ForensicReportResponse {
  runId: string;
  url: string;
  date: string;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED' | string;
  /** Precise termination taxonomy; absent on reports predating it. */
  outcome?: RunTerminationOutcome;
  endedReason?: string;
  /** Infiltration profile the run executed; absent on reports predating it. */
  infiltrationProfile?: InfiltrationProfileId;
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
    /** True when rootCause/recommendations came from the on-demand LLM, not the templated analysis. */
    aiGenerated?: boolean;
  } | null;
  metrics: {
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




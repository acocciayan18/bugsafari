// Re-export shared telemetry types for the dashboard.
// This keeps front-end code decoupled from shared folder structure.

export type {
  ActionBreadcrumb,
  ActionRecord,
  ActionType,
  ForensicCrashReport,
  IncidentReport,
  FindingAttribution,
  TelemetryEvent,
  TelemetryType,
  TelemetryMeta,
  ExceptionDetails,
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
  // Unified Infiltration Profiles (operator-facing preset layer)
  InfiltrationProfileId,
  InfiltrationProfileOption,
  // Automated Regression Verification (Verify Fix)
  RegressionVerdict,
  VerifyFixRequest,
  VerifyFixResult,
  VerifyFixProgress,
  VerifyFixPhase,
  RegressionSignal,
  // Session recovery & reconnection
  ActiveSessionSnapshot,
  SessionAttachRequest,
  SessionAttachAck,
  RunLifecycleStatus,
  SessionOwnerType,
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
} from '../../shared/types.js';

// Local binding (the re-export above does not bring the name into local scope).
import type { FindingAttribution } from '../../shared/types.js';

export interface BrowserConsoleMessage {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  url?: string;
  line?: number;
}

export interface SessionHistoryEntry {
  id: string;
  targetUrl: string;
  status: 'Running' | 'Completed' | 'Crashed';
  startedAt: string;
  finishedAt?: string;
  endedReason?: string;
  savedManually: boolean;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshots: number;
  runtimeMs?: number;
  coveragePercentage?: number;
  maxActions?: number;
}

// ─────────────────────────────────────────────────────────────
// 🔬 FORENSIC INSPECTION REPORT TYPES
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
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: string;
  /** Full stack trace captured live, preserved verbatim into history. */
  stackTrace?: string;
  /** Per-finding, human-actionable numbered replication checklist. */
  reproductionSteps?: string[];
  /** Per-finding minimized, replayable action trace — the same timeline Verify Fix replays. */
  actionSteps?: ForensicActionStep[];
  /** Deterministic knowledge-base classification + scenario/step attribution. */
  attribution?: FindingAttribution;
}

export interface ForensicReportResponse {
  runId: string;
  url: string;
  date: string;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED' | string;
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
}

// ─────────────────────────────────────────────────────────────
// 👤 USER SETTINGS TYPES
// ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  createdAt?: string;
}

export interface UserSettings {
  theme: 'light' | 'dark';
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

export type ThemeMode = 'light' | 'dark';




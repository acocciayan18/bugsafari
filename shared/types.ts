// ═══════════════════════════════════════════════════════════════
// shared/types.ts - SHARED DATA MODEL BLUEPRINT
// ═══════════════════════════════════════════════════════════════

export type TelemetryType = 'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE' | 'BUG';

export type SemanticRole =
  | 'LOGIN'
  | 'SEARCH'
  | 'SUBMIT'
  | 'CANCEL'
  | 'DESTRUCTIVE'
  | 'NAVIGATE'
  | 'INPUT'
  | 'UNKNOWN';

// ─────────────────────────────────────────────────────────────
// 🧠 BUGSAFARI AI EXPERT SYSTEM TYPE GATES
// ─────────────────────────────────────────────────────────────

export interface IntelligentDiagnosis {
  vulnerabilityClass: string;
  cwe: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  explanation: string;
  suggestedFix: string;
}

export interface ExceptionDetails {
  message: string;
  stackTrace: string;
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY DISCRIMINATED UNIONS (ISP Refactoring)
// Each telemetry type has its own specific meta fields for type safety
// ═══════════════════════════════════════════════════════════════

// Base fields common to all telemetry types
export interface TelemetryBase {
  timestamp: string;
}

// Action telemetry meta - specific fields for ACTION type
export interface ActionTelemetryMeta {
  selector?: string;
  actionExecuted?: string;
  message?: string;
  score?: number;
  url?: string;
  semanticRole?: SemanticRole;
  sessionId?: string;
  stateHash?: string;
}

// Network telemetry meta - specific fields for NETWORK type
export interface NetworkTelemetryMeta {
  url?: string;
  method?: string;
  statusCode?: number;
  status?: number;
  durationMs?: number;
  message?: string;
  blockedUrl?: string;
}

// Exception telemetry meta - specific fields for EXCEPTION type
export interface ExceptionTelemetryMeta {
  message?: string;
  exceptionDetails?: ExceptionDetails;
  reproductionSteps?: string[];
  url?: string;
  aiDiagnostics?: IntelligentDiagnosis;
  severity?: 'CRITICAL' | 'WARNING' | 'INFO';
}

// Heuristic score telemetry meta - specific fields for HEURISTIC_SCORE type
export interface HeuristicScoreTelemetryMeta {
  selector?: string;
  score?: number;
  message?: string;
  tagName?: string;
  semanticRole?: SemanticRole;
}

// Bug telemetry meta - specific fields for BUG type
export interface BugTelemetryMeta {
  message?: string;
  selector?: string;
  url?: string;
  score?: number;
  ssimScore?: number;
  visualRegressionType?: 'CSS_BREAKAGE' | 'Z_INDEX_OVERLAP' | 'RENDER_FAILURE';
  aiDiagnostics?: IntelligentDiagnosis;
  severity?: 'CRITICAL' | 'WARNING' | 'INFO';
}

// Discriminated union for TelemetryEvent
export type TelemetryEvent =
  | (TelemetryBase & { type: 'ACTION'; meta: ActionTelemetryMeta })
  | (TelemetryBase & { type: 'NETWORK'; meta: NetworkTelemetryMeta })
  | (TelemetryBase & { type: 'EXCEPTION'; meta: ExceptionTelemetryMeta })
  | (TelemetryBase & { type: 'HEURISTIC_SCORE'; meta: HeuristicScoreTelemetryMeta })
  | (TelemetryBase & { type: 'BUG'; meta: BugTelemetryMeta });

// Backward compatibility type alias (deprecated - use discriminated union)
export type TelemetryMeta =
  | ActionTelemetryMeta
  | NetworkTelemetryMeta
  | ExceptionTelemetryMeta
  | HeuristicScoreTelemetryMeta
  | BugTelemetryMeta;

export interface ActionBreadcrumb {
  timestamp: string;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

export type ActionType = 'CLICK' | 'INPUT' | 'HOVER' | 'NAVIGATION';

export interface ActionRecord {
  timestamp: string;
  type: ActionType;
  selector: string;
  url: string;
  payload?: string;
  fallbackLabel?: string;
}

export interface IncidentReport {
  timestamp: string;
  reason: string;
  url: string;
  statusCode?: number;
  stackTrace?: string;
  steps: ActionRecord[];
}

export interface ForensicCrashReport {
  timestamp: string;
  reason: string;
  statusCode?: number;
  url: string;
  stackTrace?: string;
  breadcrumbs: ActionBreadcrumb[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiscoveredElement {
  tagName: string;
  id: string;
  className: string;
  type: string;
  name: string;
  text: string;
  selector: string;
  semanticRole: SemanticRole;
  score: number;
  isVisible: boolean;
  boundingBox: BoundingBox;
}

// ─────────────────────────────────────────────────────────────
// 🚀 OPTIMIZATION SETTINGS (Shared between backend and frontend)
// ─────────────────────────────────────────────────────────────

export interface OptimizationSettings {
  'adaptive-risk-scorer': boolean;
  'state-aware-hashing': boolean;
  'concurrent-spam-event': boolean;
}

export const defaultOptimizationSettings: OptimizationSettings = {
  'adaptive-risk-scorer': true,
  'state-aware-hashing': true,
  'concurrent-spam-event': true,
};

// ─────────────────────────────────────────────────────────────
// 🔧 FRONTEND STATE TYPES (Shared for consistency)
// ─────────────────────────────────────────────────────────────

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

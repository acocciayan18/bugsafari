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

export interface TelemetryMeta {
  selector?: string;
  actionExecuted?: string;
  statusCode?: number;
  status?: number;
  url?: string;
  method?: string;
  durationMs?: number;
  score?: number;
  tagName?: string;
  semanticRole?: SemanticRole;
  stateHash?: string;
  message?: string;
  blockedUrl?: string;
  exceptionDetails?: ExceptionDetails;
  reproductionSteps?: string[];
  ssimScore?: number;
  visualRegressionType?: 'CSS_BREAKAGE' | 'Z_INDEX_OVERLAP' | 'RENDER_FAILURE';
  // 🧠 Optional parameter allowing the React client state logic to read inference mappings
  aiDiagnostics?: IntelligentDiagnosis;
  // Session tracking for forensic history
  sessionId?: string;
  // Severity from AI inference (used by BugClassifier)
  severity?: 'CRITICAL' | 'WARNING' | 'INFO';
  // Timer sync fields for session timebox tracking (only counts when NOT paused)
  remainingTimeMs?: number;
  elapsedTimeMs?: number;
}

export interface TelemetryEvent {
  timestamp: string;
  type: TelemetryType;
  meta: TelemetryMeta;
}

export interface ActionBreadcrumb {
  timestamp: string;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

export type ActionType = 'CLICK' | 'INPUT' | 'HOVER' | 'NAVIGATION' | 'NAVIGATE' | 'TYPE' | 'SUBMIT';

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
  // Pre-generated sequential narrative steps for human reproduction
  reproductionPlaybook?: string[];
}

export interface ForensicCrashReport {
  timestamp: string;
  reason: string;
  statusCode?: number;
  url: string;
  stackTrace?: string;
  breadcrumbs: ActionBreadcrumb[];
  // Pre-generated sequential narrative steps for human reproduction
  reproductionPlaybook?: string[];
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
  // Phase 3: Bounded Compute Integration
  'execution-timebox-ms'?: number;  // Time-based limit in milliseconds (default: 180000 = 3 minutes)
}

export const defaultOptimizationSettings: OptimizationSettings = {
  'adaptive-risk-scorer': true,
  'state-aware-hashing': true,
  'concurrent-spam-event': true,
  'execution-timebox-ms': 180000,  // 3 minutes default
};

// ─────────────────────────────────────────────────────────────
// 🎛️ TESTING TYPE SELECTOR (Operator-gated scenario matrix)
// ─────────────────────────────────────────────────────────────
// Single source of truth shared between the frontend checklist and the
// backend execution gating, so the two can never drift. Each strategy
// category maps to one or more backend stress-scenario `name`s.

/** Strategy categories an operator can toggle before launching a run. */
export type TestingTypeId =
  | 'exploratory'
  | 'formBypass'
  | 'dataFuzzing'
  | 'concurrency'
  | 'navigation';

export interface TestingTypeOption {
  /** Stable identifier transmitted in the run payload. */
  id: TestingTypeId;
  /** Operator-facing label rendered in the dashboard checklist. */
  label: string;
  /** Short description of what the category does. */
  description: string;
  /** Backend stress-scenario `name`s this category gates. */
  scenarios: string[];
}

/**
 * Canonical catalog of selectable testing strategies. The `scenarios` arrays
 * use the exact `name` field of each backend StressScenario so the gate can
 * resolve a scenario back to its owning category.
 */
export const TESTING_TYPE_CATALOG: TestingTypeOption[] = [
  {
    id: 'exploratory',
    label: 'Client-Side Exploratory Testing',
    description: 'DOM-aware targeting & scorer-driven normal interaction (payload injection + ordinary clicks).',
    scenarios: [],
  },
  {
    id: 'formBypass',
    label: 'Constraint Stripping & Form Bypass',
    description: 'Strips client-side validation/hardening to force interactions (FormBypasser).',
    scenarios: ['FormBypasser'],
  },
  {
    id: 'dataFuzzing',
    label: 'Context-Aware Data Fuzzing',
    description: 'Classifies inputs and injects boundary/malformed payloads (DataFuzzer).',
    scenarios: ['DataFuzzer'],
  },
  {
    id: 'concurrency',
    label: 'Overlapping Concurrency Stress',
    description: 'Rapid concurrent clicks & coordinate bombing to trigger race conditions.',
    scenarios: ['ButtonSpammer', 'CoordinateBombing'],
  },
  {
    id: 'navigation',
    label: 'Navigational Path Infiltration & Traversal',
    description: 'History trashing, URL mutation, and network sabotage (RouteTrasher, NetworkSaboteur).',
    scenarios: ['RouteTrasher', 'NetworkSaboteur'],
  },
];

/** All testing-type ids — the default selection (everything enabled). */
export const ALL_TESTING_TYPE_IDS: TestingTypeId[] = TESTING_TYPE_CATALOG.map((option) => option.id);

/**
 * Optional run-configuration payload appended to the exploration start request.
 * When `selectedScenarios` is omitted or empty the engine treats all categories
 * as enabled (backward compatible).
 */
export interface ExplorationRunConfig {
  selectedScenarios?: TestingTypeId[];
}

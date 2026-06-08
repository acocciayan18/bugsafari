// ═══════════════════════════════════════════════════════════════
// shared/types.ts - SHARED DATA MODEL BLUEPRINT
// ═══════════════════════════════════════════════════════════════

export type TelemetryType = 'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE';

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
  // 🧠 Optional parameter allowing the React client state logic to read inference mappings
  aiDiagnostics?: IntelligentDiagnosis;
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
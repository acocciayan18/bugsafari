// ═══════════════════════════════════════════════════════════════
// shared/types/telemetry.ts - TELEMETRY EVENT MODELS & META CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Telemetry stream shapes plus the element/diagnosis payloads that feed them.

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

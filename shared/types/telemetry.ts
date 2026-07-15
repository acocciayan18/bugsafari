// ═══════════════════════════════════════════════════════════════
// shared/types/telemetry.ts - TELEMETRY EVENT MODELS & META CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Telemetry stream shapes plus the element/diagnosis payloads that feed them.

import type { FindingAttribution } from './bug.js';

export type TelemetryType = 'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE' | 'BUG';

// ─────────────────────────────────────────────────────────────
// ♿ ACCESSIBILITY (WCAG) TELEMETRY — isolated from the fault pipeline
// ─────────────────────────────────────────────────────────────

// Dedicated Socket.IO channel so WCAG findings never mix with the generic
// telemetry/error streams (client/server share this const to avoid drift).
export const ACCESSIBILITY_EVENT = 'accessibility' as const;

// Aggregate gate: once this many distinct WCAG violations surface in a run the
// engine stops auditing and the dashboard shows one summarizing warning banner
// (no per-finding list). Tunable in one place — both packages read this const.
export const ACCESSIBILITY_BANNER_THRESHOLD = 10;

// axe-core-style impact bucket for a WCAG violation.
export type A11yImpact = 'critical' | 'serious' | 'moderate' | 'minor';

// A single WCAG finding streamed on the dedicated accessibility channel.
export interface AccessibilityFinding {
  timestamp: string;
  rule: string;
  wcag: string;
  impact: A11yImpact;
  selector: string;
  description: string;
  suggestedFix: string;
}

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
  // Deterministic classification + scenario/step attribution for a fault event.
  attribution?: FindingAttribution;
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

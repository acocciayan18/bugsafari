// ═══════════════════════════════════════════════════════════════
// shared/types/telemetry.ts - TELEMETRY EVENT MODELS & META CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Telemetry stream shapes plus the element/diagnosis payloads that feed them.

import type { FindingAttribution } from './bug.js';

export type TelemetryType = 'ACTION' | 'NETWORK' | 'EXCEPTION' | 'HEURISTIC_SCORE' | 'BUG';

// ─────────────────────────────────────────────────────────────
//  ACCESSIBILITY (WCAG) TELEMETRY — isolated from the fault pipeline
// ─────────────────────────────────────────────────────────────

// Dedicated Socket.IO channel so WCAG findings never mix with the generic
// telemetry/error streams (client/server share this const to avoid drift).
export const ACCESSIBILITY_EVENT = 'accessibility' as const;

// Aggregate gate: once this many distinct WCAG violations surface in a run the
// engine stops auditing and the dashboard shows one summarizing warning banner
// (no per-finding list). Tunable in one place — both packages read this const.
export const ACCESSIBILITY_BANNER_THRESHOLD = 10;

// Marker prepended to reproduction-step lines that are observed RESULTS (e.g. a
// route mutation triggered a crash) rather than actions a human performs. Both
// packages read this const so the renderer can split observations out of the
// numbered "do these steps" list without brittle text matching.
export const OBSERVATION_PREFIX = '⟦OBSERVED⟧ ';

// axe-core-style impact bucket for a WCAG violation.
export type A11yImpact = 'critical' | 'serious' | 'moderate' | 'minor';

// A single WCAG finding streamed on the dedicated accessibility channel.
export interface AccessibilityFinding {
  timestamp: string;
  rule: string;
  wcag: string;
  impact: A11yImpact;
  /** Raw selector — internal locator for debugging only; never rendered. */
  selector: string;
  /** Human name of the offending element (tag + id/class, or its text). */
  elementName: string;
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
//  BUGSAFARI AI EXPERT SYSTEM TYPE GATES
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
  /** Set on the terminal `engine-stopped` event so the UI classifies the ending
   *  without parsing its message. */
  terminationOutcome?: import('./termination.js').RunTerminationOutcome;
  /** Bare engine reason behind {@link terminationOutcome}, surfaced verbatim on the
   *  terminal `engine-stopped` event so a surface can show the cause without the
   *  label prefix that {@link message} carries. */
  terminationReason?: string;
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
  // ── Raw network row (Network tab) ──────────────────────────────
  // Marks a genuine observed target-app request (from recordNetworkLog), as opposed
  // to a BugSafari finding/diagnostic that merely rides the NETWORK channel. Only
  // rawNetwork events populate the Network tab.
  rawNetwork?: boolean;
  /** True for a 2xx/3xx response; false for a 4xx/5xx or a transport failure. */
  ok?: boolean;
  /** Playwright request resourceType (xhr/fetch/document/image…) — backstops asset detection in routing. */
  resourceType?: string;
  /** Browser/network error text for a transport failure (e.g. net::ERR_TIMED_OUT). */
  errorText?: string;
  /** Correlation/trace id parsed from request or response headers, when the app sends one. */
  traceId?: string;
  /** Curated, size-bounded request headers (content-type, accept, trace ids…). */
  requestHeaders?: Record<string, string>;
  /** Curated, size-bounded response headers (content-type, cache-control, trace ids…). */
  responseHeaders?: Record<string, string>;
  exceptionDetails?: ExceptionDetails;
  reproductionSteps?: string[];
  //  Optional parameter allowing the React client state logic to read inference mappings
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

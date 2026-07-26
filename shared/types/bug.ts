// ═══════════════════════════════════════════════════════════════
// shared/types/bug.ts - FORENSIC REPORTS & REPRODUCTION INDICATORS
// ═══════════════════════════════════════════════════════════════
// Crash/incident reports plus the action breadcrumb/record shapes that
// compose the reproduction playbook.

import type { FaultConfidence, FaultOrigin, VerificationStatus } from './verification.js';
import type { IntelligentDiagnosis } from './telemetry.js';

export interface ActionBreadcrumb {
  timestamp: string;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

/**
 * Deterministic classification + attribution attached to every finding.
 * Answers "what kind of bug, from which scenario, at which step" so a finding is
 * traceable end-to-end. Produced by the knowledge-base FaultClassifier; all fields
 * are optional on the wire so older records/clients remain valid.
 */
export interface FindingAttribution {
  /** Knowledge-base BugClass (e.g. 'NOSQL_INJECTION'). */
  bugClass: string;
  /** MITRE CWE identifier (e.g. 'CWE-943'). */
  cwe?: string;
  /** Scenario that provoked the fault (e.g. 'DataFuzzer', 'Exploratory'). */
  scenario?: string;
  /** Operator testing-type category owning the scenario. */
  testingType?: string;
  /** Chronological step index in the reproduction timeline at fault time. */
  stepIndex?: number;
  // ── Verification verdict (finding-verification pipeline) ──
  // Optional on the wire so older records/clients remain valid. Populated once the
  // fault has passed provenance + evidence scoring; absent ⇒ legacy/unverified.
  /** Where the root cause was attributed. Only 'TARGET_APP' is a genuine defect. */
  origin?: FaultOrigin;
  /** Evidence strength behind {@link bugClass}. */
  confidence?: FaultConfidence;
  /** Terminal verification state — CONFIRMED / NEEDS_VERIFICATION / INCONCLUSIVE. */
  verificationStatus?: VerificationStatus;
  /** Normalized 0–1 confidence score that produced {@link verificationStatus}. */
  confidenceScore?: number;
  /** True when a repeat occurrence or a second channel corroborated the fault. */
  corroborated?: boolean;
  /**
   * Why the routing tree promoted this to a finding (RoutingReasonCode). Absent on
   * runtime faults, which are findings by definition, and on records predating it.
   * Lets the dashboard re-apply the same decision without re-deriving it from prose.
   */
  routingReason?: string;
}

export type ActionType = 'CLICK' | 'INPUT' | 'HOVER' | 'NAVIGATION' | 'NAVIGATE' | 'TYPE' | 'SUBMIT' | 'NETWORK' | 'MACRO';

/** Backend-classified severity of a fault — mirrors the persisted ForensicErrorSeverity scale. */
export type FaultSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * A deterministic stress-scenario burst that replays by re-expansion, not by a
 * single literal step. Carries only the params needed to regenerate the exact
 * action sequence during regression replay, plus a human summary for the playbook.
 */
export interface ReplayMacro {
  scenario: 'CoordinateBombing' | 'RouteTrasher' | 'ConcurrentSiblingBurst';
  params: {
    count?: number;
    width?: number;
    height?: number;
    repetitions?: number;
    selectors?: string[];
    /** Human descriptors of the burst elements, index-aligned with `selectors`. */
    targets?: StepTarget[];
  };
  /** Human-readable one-line summary — reused as the narration fallback. */
  summary: string;
}

/** A named UI control as a developer sees it — `{ label: 'Register', kind: 'button' }`. */
export interface StepTarget {
  label: string;
  kind: string;
}

/** What actually happened after an action ran — appended to the step as an outcome clause. */
export interface ActionOutcome {
  /** Absolute URL the action navigated to, if it caused a navigation. */
  navigatedTo?: string;
  /** Backend status code observed for the action's request, if any. */
  httpStatus?: number;
  /** True when the action measurably changed the DOM/app state. */
  domChanged?: boolean;
}

export interface ActionRecord {
  timestamp: string;
  type: ActionType;
  selector: string;
  url: string;
  payload?: string;
  fallbackLabel?: string;
  /** Human-readable element label resolved at record time (preferred over fallbackLabel). */
  elementLabel?: string;
  /** Plain-English control type resolved at record time — button, link, field, dropdown… */
  elementKind?: string;
  /** Consecutive identical repeats collapsed into this record (>1 ⇒ "repeat N times"). */
  repeatCount?: number;
  /** Real execution time of the action in ms (measured in the executor). */
  durationMs?: number;
  /** Present only on a MACRO record — the re-expandable stress-scenario descriptor. */
  macro?: ReplayMacro;
  /** Validation attributes stripped on a SUBMIT/bypass step (required, maxlength, pattern, …). */
  strippedAttributes?: string[];
  /** Count of elements a bypass step affected (target + siblings + form). */
  affectedCount?: number;
  /** Observed result of the action, rendered as an outcome clause on the step. */
  outcome?: ActionOutcome;
  /** True ⇒ narration masks the payload value (auth/password fields); replay keeps it verbatim. */
  redactValue?: boolean;
}

/**
 * A bounded snapshot of client-side state at fault time, restored into the fresh
 * regression-replay browser so cross-page-state bugs reproduce. Size-capped at
 * capture (see captureStateFingerprint); values are kept verbatim.
 */
export interface StateFingerprint {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookies?: { name: string; value: string; domain?: string; path?: string }[];
}

/**
 * The per-finding reproduction evidence, frozen at fault time.
 *
 * `actions` is the MINIMIZED, machine-replayable action timeline — only the steps
 * causally required to reach the fault (see forensics/stepMinimizer). `narrative`
 * is the human-readable rendering of exactly those same actions. Both describe one
 * timeline, so what a developer follows by hand is what the regression verifier
 * replays.
 */
export interface ReproductionSnapshot {
  actions: ActionRecord[];
  narrative: string[];
}

/**
 * Structured evidence for a confirmed CLIENT_SIDE_CONSTRAINT_BYPASS — the fields the
 * finding card's metadata grid renders so a developer reads the exact field, payload,
 * stripped guard, and accepting endpoint instead of parsing them out of prose.
 */
export interface ConstraintBypassDetail {
  /** Human element descriptor, e.g. `Input: "Business Name" (id: #businessName)`. */
  element: string;
  /** The browser-rejected value the server accepted ('' ⇒ empty submission). */
  payload: string;
  /** The client-only constraint that was stripped (required, maxlength=40, type=email). */
  strippedAttribute: string;
  /** Relative request path the value reached — domain stripped. */
  endpoint: string;
  /** State-changing method of the accepting request. */
  method: string;
  /** HTTP status the server answered with. */
  status: number;
}

export interface IncidentReport {
  // Stable finding id, matching the confirmed-bug ledger. Lets a later verdict
  // (e.g. an in-run reproduction result) patch this exact card instead of adding one.
  bugId?: string;
  timestamp: string;
  reason: string;
  url: string;
  statusCode?: number;
  stackTrace?: string;
  steps: ActionRecord[];
  // Minimized, replayable per-finding timeline (with any stress-scenario MACRO) —
  // carried so a queue-mode client-transfer save preserves what Verify Fix replays.
  reproductionActions?: ActionRecord[];
  // Client-state snapshot at fault time, restored before regression replay.
  stateFingerprint?: StateFingerprint;
  // Pre-generated sequential narrative steps for human reproduction
  reproductionPlaybook?: string[];
  // Per-finding remediation (buildRemediation output) — identical to the value
  // saved on the matching confirmed bug, so the live card and history card show
  // the same Suggested Fix.
  advice?: string;
  // Deterministic classification + scenario/step attribution for this incident.
  attribution?: FindingAttribution;
  // Frontend-accumulated repeat count for this fault this session; backend leaves unset.
  occurrences?: number;
  // Backend-classified severity (knowledge-base → forensic scale). Drives the UI
  // severity badge instead of a hard-coded string.
  severity?: FaultSeverity;
  // Top stack frames resolved through the target's source maps to original
  // file:line:col — best-effort (absent when no usable map was reachable).
  resolvedStackTrace?: string;
  // The control that actually caused the fault, resolved from the interaction
  // active at fault time — authoritative over the last timeline step, which lags
  // behind async faults and points at a later/burst action.
  culpritSelector?: string;
  // Heuristic expert-system diagnosis (vulnerability class / CWE / fix) surfaced
  // on the finding card. Optional — absent when the classifier had no match.
  aiDiagnostics?: IntelligentDiagnosis;
  // Structured constraint-bypass evidence — present only on CLIENT_SIDE_CONSTRAINT_BYPASS.
  bypass?: ConstraintBypassDetail;
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
  // Per-finding remediation (buildRemediation output) — see IncidentReport.advice.
  advice?: string;
  // Deterministic classification + scenario/step attribution for this crash.
  attribution?: FindingAttribution;
  // Frontend-accumulated repeat count for this fault this session; backend leaves unset.
  occurrences?: number;
  // Backend-classified severity (knowledge-base → forensic scale). Drives the UI
  // severity badge instead of a hard-coded string.
  severity?: FaultSeverity;
  // Top stack frames resolved through the target's source maps to original
  // file:line:col — best-effort (absent when no usable map was reachable).
  resolvedStackTrace?: string;
  // The control that actually caused the fault (see IncidentReport.culpritSelector).
  culpritSelector?: string;
  // Heuristic expert-system diagnosis — see IncidentReport.aiDiagnostics.
  aiDiagnostics?: IntelligentDiagnosis;
}

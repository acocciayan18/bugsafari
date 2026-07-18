// ═══════════════════════════════════════════════════════════════
// shared/types/bug.ts - FORENSIC REPORTS & REPRODUCTION INDICATORS
// ═══════════════════════════════════════════════════════════════
// Crash/incident reports plus the action breadcrumb/record shapes that
// compose the reproduction playbook.

import type { FaultConfidence, FaultOrigin, VerificationStatus } from './verification.js';

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
}

export type ActionType = 'CLICK' | 'INPUT' | 'HOVER' | 'NAVIGATION' | 'NAVIGATE' | 'TYPE' | 'SUBMIT' | 'NETWORK' | 'MACRO';

/**
 * A deterministic stress-scenario burst that replays by re-expansion, not by a
 * single literal step. Carries only the params needed to regenerate the exact
 * action sequence during regression replay, plus a human summary for the playbook.
 */
export interface ReplayMacro {
  scenario: 'CoordinateBombing' | 'RouteTrasher' | 'ConcurrentSiblingBurst';
  params: { count?: number; width?: number; height?: number; repetitions?: number; selectors?: string[] };
  /** Human-readable one-line summary — reused as the narration fallback. */
  summary: string;
}

export interface ActionRecord {
  timestamp: string;
  type: ActionType;
  selector: string;
  url: string;
  payload?: string;
  fallbackLabel?: string;
  /** Consecutive identical repeats collapsed into this record (>1 ⇒ "repeat N times"). */
  repeatCount?: number;
  /** Real execution time of the action in ms (measured in the executor). */
  durationMs?: number;
  /** Present only on a MACRO record — the re-expandable stress-scenario descriptor. */
  macro?: ReplayMacro;
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

export interface IncidentReport {
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
}

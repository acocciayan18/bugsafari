// ═══════════════════════════════════════════════════════════════
// shared/types/bug.ts - FORENSIC REPORTS & REPRODUCTION INDICATORS
// ═══════════════════════════════════════════════════════════════
// Crash/incident reports plus the action breadcrumb/record shapes that
// compose the reproduction playbook.

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
  // Per-finding remediation (buildRemediation output) — identical to the value
  // saved on the matching confirmed bug, so the live card and history card show
  // the same Suggested Fix.
  advice?: string;
  // Deterministic classification + scenario/step attribution for this incident.
  attribution?: FindingAttribution;
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
}

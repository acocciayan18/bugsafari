// shared/severity.ts - CENTRAL SEVERITY POLICY
// Single source of truth for finding severity, used by both packages so every
// finding is guaranteed a FaultSeverity before it is stored or displayed. Pure
// and deterministic: same input always yields the same severity.

import type { FaultSeverity } from './types/bug.js';
import type { FaultConfidence, VerificationStatus } from './types/verification.js';

export const SEVERITY_ORDER: readonly FaultSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const SEVERITY_RANK: Record<FaultSeverity, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

// Fallback when a finding carries no severity and no known bug class — never undefined.
export const DEFAULT_SEVERITY: FaultSeverity = 'MEDIUM';

// Bug-class → default severity. Mirrors testing-core BUG_CATALOG defaults; string-keyed
// to stay decoupled from the engine's BugClass type. A drift test guards the two.
export const SEVERITY_BY_BUGCLASS: Record<string, FaultSeverity> = {
  INPUT_SANITIZATION_FAILURE: 'MEDIUM',
  CLIENT_SIDE_CONSTRAINT_BYPASS: 'MEDIUM',
  NOSQL_INJECTION: 'HIGH',
  SQL_INJECTION: 'CRITICAL',
  SPA_STATE_RACE_CONDITION: 'HIGH',
  STRUCTURAL_NAVIGATION_LOGIC: 'HIGH',
  RUNTIME_STABILITY_EXCEPTION: 'HIGH',
  API_CONTRACT_VIOLATION: 'HIGH',
  BOUNDARY_STRESS_FAILURE: 'HIGH',
  FUZZ_VULNERABILITY_LEAK: 'CRITICAL',
  SECURITY_VULNERABILITY_LEAK: 'HIGH',
  CASCADING_STATE_FAILURE: 'HIGH',
  ROUTE_MUTATION_FAILURE: 'HIGH',
  CLIENT_TRUST_BOUNDARY_VIOLATION: 'CRITICAL',
  INFINITE_LOADING: 'HIGH',
  CLIENT_RENDER_FREEZE: 'HIGH',
  SESSION_SYNC_FAULT: 'HIGH',
};

const VALID = new Set<string>(SEVERITY_ORDER);

// Legacy 3-tier telemetry/AI scale (CRITICAL|WARNING|INFO) → canonical 5-tier.
const LEGACY_ALIAS: Record<string, FaultSeverity> = { WARNING: 'MEDIUM', WARN: 'MEDIUM' };

// Coerce any severity-ish value to a canonical FaultSeverity, falling back to the
// bug-class default, then DEFAULT_SEVERITY. Case-insensitive; never undefined.
export function normalizeSeverity(value?: string | null, bugClass?: string): FaultSeverity {
  const up = (value ?? '').trim().toUpperCase();
  if (VALID.has(up)) return up as FaultSeverity;
  if (LEGACY_ALIAS[up]) return LEGACY_ALIAS[up];
  if (bugClass && SEVERITY_BY_BUGCLASS[bugClass]) return SEVERITY_BY_BUGCLASS[bugClass];
  return DEFAULT_SEVERITY;
}

// Clamp a severity to at most `max`.
export function capSeverity(sev: FaultSeverity, max: FaultSeverity): FaultSeverity {
  return SEVERITY_RANK[sev] > SEVERITY_RANK[max] ? max : sev;
}

export interface SeverityInput {
  severity?: string | null;
  bugClass?: string;
  // Widened to string so persisted (lean-doc) findings, whose attribution fields are
  // typed as plain String, resolve without a cast; compared by value below.
  confidence?: FaultConfidence | string;
  verificationStatus?: VerificationStatus | string;
  statusCode?: number;
}

// The one policy every site uses. Normalize base → cap at MEDIUM for low-confidence
// or unverified findings → escalate to >=HIGH on a 5xx (a server fault outranks the
// confidence cap). Idempotent, so re-applying at each boundary is safe.
export function resolveSeverity(input: SeverityInput): FaultSeverity {
  let sev = normalizeSeverity(input.severity, input.bugClass);
  const lowConfidence =
    input.confidence === 'INFERRED' ||
    input.verificationStatus === 'NEEDS_VERIFICATION' ||
    input.verificationStatus === 'INCONCLUSIVE';
  if (lowConfidence) sev = capSeverity(sev, 'MEDIUM');
  if (input.statusCode !== undefined && input.statusCode >= 500 && SEVERITY_RANK[sev] < SEVERITY_RANK.HIGH) {
    sev = 'HIGH';
  }
  return sev;
}

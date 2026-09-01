import type { BugClass, BugFinding } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// knowledgeBase/securityEvidenceGate.ts — BEHAVIORAL-EVIDENCE GATE
// ═══════════════════════════════════════════════════════════════
// A vuln finding may be reported ONLY with real behavioral/backend proof, never
// because a field merely accepts text or special characters. This is the single
// owner of that rule, reused by both finding-promotion chokepoints (BugFinderRunner
// + ActionExecutor.registerFuzzFinding) so the policy is enforced, not per-finder discipline.

// Vuln classes that must never be reported on presence alone; they need behavioral proof.
export const PROOF_REQUIRED_CLASSES: ReadonlySet<BugClass> = new Set<BugClass>([
  'NOSQL_INJECTION',
  'SQL_INJECTION',
  'FUZZ_VULNERABILITY_LEAK',
  'SECURITY_VULNERABILITY_LEAK',
  'CLIENT_TRUST_BOUNDARY_VIOLATION',
  'CLIENT_SIDE_CONSTRAINT_BYPASS',
]);

// True ⇒ this class demands behavioral proof before it may be reported.
export function requiresBehavioralProof(bugClass: BugClass): boolean {
  return PROOF_REQUIRED_CLASSES.has(bugClass);
}

// Real proof: a correlated server response (status/endpoint), a matched runtime signal
// signature, or a structured bypass carrying a proven adverse effect. Excludes
// payload/selector/message; those are input characteristics, not proof of impact. A bare
// bypass (constraint stripped, value merely accepted) counts ONLY with an effect marker —
// acceptance alone is not impact.
export function hasBehavioralProof(finding: Pick<BugFinding, 'evidence'>): boolean {
  const e = finding.evidence;
  if (!e) return false;
  return (
    typeof e.statusCode === 'number' ||
    typeof e.specifics?.statusCode === 'number' ||
    Boolean(e.specifics?.endpoint) ||
    (e.signals?.length ?? 0) > 0 ||
    Boolean(e.bypass?.effect)
  );
}

// The single decision both promotion paths call before registering a finding.
export function isReportableSecurityFinding(finding: Pick<BugFinding, 'bugClass' | 'evidence'>): boolean {
  return !requiresBehavioralProof(finding.bugClass) || hasBehavioralProof(finding);
}

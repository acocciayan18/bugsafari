// Standalone deterministic test for the behavioral-evidence gate.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/bugs/knowledgeBase/securityEvidenceGate.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { BugClass, BugFinding } from '../types.js';
import { requiresBehavioralProof, hasBehavioralProof, isReportableSecurityFinding } from './securityEvidenceGate.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Minimal finding builder — only bugClass + evidence matter to the gate.
function f(bugClass: BugClass, evidence?: BugFinding['evidence']): BugFinding {
  return { bugClass, title: 't', severity: 'HIGH', evidence };
}

console.log('securityEvidenceGate — which classes demand proof');

check('the named vuln classes require behavioral proof', () => {
  const gated: BugClass[] = ['NOSQL_INJECTION', 'SQL_INJECTION', 'FUZZ_VULNERABILITY_LEAK', 'SECURITY_VULNERABILITY_LEAK', 'CLIENT_TRUST_BOUNDARY_VIOLATION'];
  for (const c of gated) assert.equal(requiresBehavioralProof(c), true, c);
});

check('non-vuln classes never require proof', () => {
  const ungated: BugClass[] = ['ROUTE_MUTATION_FAILURE', 'SPA_STATE_RACE_CONDITION', 'RUNTIME_STABILITY_EXCEPTION'];
  for (const c of ungated) assert.equal(requiresBehavioralProof(c), false, c);
});

console.log('\nsecurityEvidenceGate — proof requires an observed backend/behavioral marker, not input shape');

check('input characteristics alone (payload/selector/message) are NOT proof', () => {
  assert.equal(hasBehavioralProof(f('NOSQL_INJECTION', { payload: "' OR '1'='1", selector: '#q', message: 'the field accepted the value' })), false);
});

check('no evidence, or an empty evidence object, is not proof', () => {
  assert.equal(hasBehavioralProof(f('NOSQL_INJECTION')), false);
  assert.equal(hasBehavioralProof(f('NOSQL_INJECTION', {})), false);
});

check('an empty signals array is not proof', () => {
  assert.equal(hasBehavioralProof(f('FUZZ_VULNERABILITY_LEAK', { signals: [] })), false);
});

check('a correlated response status is proof', () => {
  assert.equal(hasBehavioralProof(f('SQL_INJECTION', { statusCode: 200 })), true);
});

check('a correlated endpoint or status in specifics is proof', () => {
  assert.equal(hasBehavioralProof(f('SQL_INJECTION', { specifics: { endpoint: '/api/login' } })), true);
  assert.equal(hasBehavioralProof(f('SQL_INJECTION', { specifics: { statusCode: 200 } })), true);
});

check('a matched runtime signal signature is proof', () => {
  assert.equal(hasBehavioralProof(f('FUZZ_VULNERABILITY_LEAK', { signals: ['XSS_REFLECTION'] })), true);
  assert.equal(hasBehavioralProof(f('NOSQL_INJECTION', { signals: ['NOSQL_ERROR'] })), true);
});

check('a structured constraint bypass is proof', () => {
  const bypass = { element: 'Input: "q" (id: #q)', payload: 'x', strippedAttribute: 'required', endpoint: '/api/save', method: 'POST', status: 200 };
  assert.equal(hasBehavioralProof(f('CLIENT_TRUST_BOUNDARY_VIOLATION', { bypass })), true);
});

console.log('\nsecurityEvidenceGate — reportable = non-vuln class OR a proven vuln');

check('a vuln finding with no proof is not reportable (the policy case)', () => {
  assert.equal(isReportableSecurityFinding(f('NOSQL_INJECTION', { payload: "' OR '1'='1", selector: '#q' })), false);
});

check('a non-vuln finding is always reportable regardless of evidence', () => {
  assert.equal(isReportableSecurityFinding(f('SPA_STATE_RACE_CONDITION', {})), true);
});

check('every real finder shape survives the gate (no legit finding is dropped)', () => {
  // noSqlInjection console/DOM-leak path: only the NOSQL_ERROR signal marker present.
  assert.equal(isReportableSecurityFinding(f('NOSQL_INJECTION', { payload: '{"$ne":null}', selector: '#u', message: 'db error', signals: ['NOSQL_ERROR'] })), true);
  // injectionDifferential: correlated operator response.
  assert.equal(isReportableSecurityFinding(f('SQL_INJECTION', { statusCode: 200, specifics: { endpoint: '/api/login', statusCode: 200 } })), true);
  // fuzzGuard XSS / crash: oracle signal.
  assert.equal(isReportableSecurityFinding(f('FUZZ_VULNERABILITY_LEAK', { signals: ['XSS_REFLECTION'] })), true);
  assert.equal(isReportableSecurityFinding(f('FUZZ_VULNERABILITY_LEAK', { signals: ['INFO_LEAK'] })), true);
});

console.log(`\nAll ${passed} assertions passed.`);

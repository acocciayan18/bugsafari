// Self-executing checks for the centralized severity policy (normalizeSeverity /
// resolveSeverity). Run with `npx tsx "shared/severity.test.ts"` or `npm test -w shared`.

import assert from 'node:assert/strict';
import { normalizeSeverity, resolveSeverity, capSeverity, DEFAULT_SEVERITY, summarizeSeverity, worstSeverity } from './severity.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('severity — centralized classification policy');

check('normalizeSeverity accepts a valid value case-insensitively', () => {
  assert.equal(normalizeSeverity('critical'), 'CRITICAL');
  assert.equal(normalizeSeverity('HIGH'), 'HIGH');
});

check('normalizeSeverity maps the legacy WARNING tier to MEDIUM', () => {
  assert.equal(normalizeSeverity('WARNING'), 'MEDIUM');
});

check('normalizeSeverity falls back to the bug-class default', () => {
  assert.equal(normalizeSeverity(null, 'SQL_INJECTION'), 'CRITICAL');
  assert.equal(normalizeSeverity(undefined, 'BOUNDARY_STRESS_FAILURE'), 'HIGH');
});

check('normalizeSeverity falls back to DEFAULT_SEVERITY for an unknown class', () => {
  assert.equal(normalizeSeverity(undefined, 'A_BRAND_NEW_UNMAPPED_CLASS'), DEFAULT_SEVERITY);
  assert.equal(normalizeSeverity(''), DEFAULT_SEVERITY);
});

check('capSeverity clamps to the ceiling', () => {
  assert.equal(capSeverity('CRITICAL', 'MEDIUM'), 'MEDIUM');
  assert.equal(capSeverity('LOW', 'MEDIUM'), 'LOW');
});

check('resolveSeverity keeps catalog severity for CONFIRMED/SIGNAL', () => {
  assert.equal(resolveSeverity({ severity: 'CRITICAL', confidence: 'CONFIRMED' }), 'CRITICAL');
  assert.equal(resolveSeverity({ severity: 'HIGH', confidence: 'SIGNAL' }), 'HIGH');
});

check('resolveSeverity caps INFERRED verdicts at MEDIUM', () => {
  assert.equal(resolveSeverity({ severity: 'HIGH', confidence: 'INFERRED' }), 'MEDIUM');
  assert.equal(resolveSeverity({ severity: 'CRITICAL', confidence: 'INFERRED' }), 'MEDIUM');
});

check('resolveSeverity caps unverified verdicts at MEDIUM', () => {
  assert.equal(resolveSeverity({ severity: 'HIGH', verificationStatus: 'NEEDS_VERIFICATION' }), 'MEDIUM');
  assert.equal(resolveSeverity({ severity: 'CRITICAL', verificationStatus: 'INCONCLUSIVE' }), 'MEDIUM');
});

check('resolveSeverity lets a 5xx escalate past the low-confidence cap', () => {
  assert.equal(resolveSeverity({ severity: 'MEDIUM', confidence: 'INFERRED', statusCode: 503 }), 'HIGH');
  assert.equal(resolveSeverity({ bugClass: 'BOUNDARY_STRESS_FAILURE', confidence: 'INFERRED', statusCode: 500 }), 'HIGH');
});

check('resolveSeverity is idempotent', () => {
  const once = resolveSeverity({ severity: 'HIGH', confidence: 'INFERRED' });
  assert.equal(resolveSeverity({ severity: once, confidence: 'INFERRED' }), once);
});

check('resolveSeverity always returns a value even with no input', () => {
  assert.equal(resolveSeverity({}), DEFAULT_SEVERITY);
});

check('summarizeSeverity reports the worst tier present and its count', () => {
  // The exact History-card bug: 2 CRITICAL + 1 MEDIUM must read "2 CRITICAL", never "3 CRITICAL".
  const s = summarizeSeverity({ CRITICAL: 2, MEDIUM: 1 });
  assert.equal(s.severity, 'CRITICAL');
  assert.equal(s.count, 2);
  assert.equal(s.total, 3);
});

check('summarizeSeverity picks HIGH when no critical is present', () => {
  const s = summarizeSeverity({ HIGH: 1, MEDIUM: 4 });
  assert.equal(s.severity, 'HIGH');
  assert.equal(s.count, 1);
  assert.equal(s.total, 5);
});

check('summarizeSeverity treats an empty/absent tally as CLEAR', () => {
  for (const empty of [undefined, null, {}, { CRITICAL: 0 }]) {
    const s = summarizeSeverity(empty);
    assert.equal(s.severity, 'CLEAR');
    assert.equal(s.count, 0);
    assert.equal(s.total, 0);
  }
});

check('worstSeverity returns the highest-ranked tier present', () => {
  assert.equal(worstSeverity(['LOW', 'HIGH', 'MEDIUM']), 'HIGH');
  assert.equal(worstSeverity(['MEDIUM', 'CRITICAL']), 'CRITICAL');
  assert.equal(worstSeverity(['INFO']), 'INFO');
});

check('worstSeverity falls back to DEFAULT_SEVERITY for an empty set', () => {
  assert.equal(worstSeverity([]), DEFAULT_SEVERITY);
});

console.log(`\nAll ${passed} assertions passed.`);

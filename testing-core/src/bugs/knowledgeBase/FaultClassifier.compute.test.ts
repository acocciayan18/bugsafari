// Regression guard for the /input-fuzzing (POST /api/compute) 5xx classification.
// A clean malformed-input 500 must read as SERVER_API_FAILURE (CWE-755), NOT the
// info-leak identity — while a 500 that DOES leak a stack must still be caught.
// Self-executing (no runner): `npx tsx "src/bugs/knowledgeBase/FaultClassifier.compute.test.ts"`.

import assert from 'node:assert/strict';
import { classifyFault } from './FaultClassifier.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const CLEAN_500 = '{"error":"compute pipeline crashed on malformed input"}';
const LEAKY_500 =
  '{"error":"compute pipeline crashed on malformed input","stack":"Error: compute pipeline crashed on malformed input\\n    at /srv/app/server/routes/injection.mjs:42:19"}';

const compute500 = (content: string) =>
  classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 500 POST /api/compute',
    statusCode: 500,
    url: 'http://target/api/compute',
    scenario: 'DataFuzzer',
    content,
  });

console.log('FaultClassifier — /api/compute 5xx classification');

check('clean malformed-input 500 → SERVER_API_FAILURE / CWE-755, not an info leak', () => {
  const r = compute500(CLEAN_500);
  assert.equal(r.bugClass, 'SERVER_API_FAILURE');
  assert.equal(r.cwe, 'CWE-755');
  assert.notEqual(r.bugClass, 'SECURITY_VULNERABILITY_LEAK');
  assert.notEqual(r.cwe, 'CWE-200');
});

check('a clean 500 is CONFIRMED and escalated to at least HIGH', () => {
  const r = compute500(CLEAN_500);
  assert.equal(r.confidence, 'CONFIRMED');
  assert.equal(r.severity, 'HIGH');
});

check('a 500 that leaks a stack frame is still caught as SECURITY_VULNERABILITY_LEAK / CWE-200', () => {
  const r = compute500(LEAKY_500);
  assert.equal(r.bugClass, 'SECURITY_VULNERABILITY_LEAK');
  assert.equal(r.cwe, 'CWE-200');
});

console.log(`\n${passed} assertion group(s) passed.`);

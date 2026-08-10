// Standalone deterministic test for the knowledge-base FaultClassifier.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/bugs/knowledgeBase/FaultClassifier.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { classifyFault } from './index.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('FaultClassifier — deterministic classification + attribution');

check('NoSQL error body during DataFuzzer → NOSQL_INJECTION', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 400 POST /api/login',
    statusCode: 400,
    content: 'MongoError: unknown operator $ne',
    scenario: 'DataFuzzer',
    stepIndex: 3,
  });
  assert.equal(c.bugClass, 'NOSQL_INJECTION');
  assert.equal(c.cwe, 'CWE-943');
  assert.equal(c.scenario, 'DataFuzzer');
  assert.equal(c.testingType, 'dataFuzzing');
  assert.equal(c.stepIndex, 3);
});

check('Unconfirmed client XSS-content under DataFuzzer is NOT auto-promoted to a security verdict', () => {
  // Tag presence alone (an unconfirmed <script> in a console message) must not label a
  // client fault FUZZ_VULNERABILITY_LEAK — that is the deprecated heuristic the reflection
  // oracle replaced, and it mislabelled plain runtime crashes (whose stack trips XSS/leak
  // patterns) as injection leaks. A client-fault security verdict now requires confirmation.
  const c = classifyFault({
    faultType: 'CONSOLE',
    message: 'reflected value',
    content: '<script>alert(1)</script>',
    scenario: 'DataFuzzer',
  });
  assert.equal(c.bugClass, 'RUNTIME_STABILITY_EXCEPTION');
});

check('Oracle-CONFIRMED reflected XSS during DataFuzzer → FUZZ_VULNERABILITY_LEAK / CRITICAL', () => {
  const c = classifyFault({
    faultType: 'CONSOLE',
    message: 'reflected value',
    content: '<script>alert(1)</script>',
    scenario: 'DataFuzzer',
    confirmed: true,
  });
  assert.equal(c.bugClass, 'FUZZ_VULNERABILITY_LEAK');
  assert.equal(c.severity, 'CRITICAL');
  assert.equal(c.cwe, 'CWE-79');
});

check('HTTP 500 during NetworkSaboteur → SERVER_API_FAILURE / HIGH (server error, not resource exhaustion)', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 500 GET /api/data',
    statusCode: 500,
    scenario: 'NetworkSaboteur',
  });
  assert.equal(c.bugClass, 'SERVER_API_FAILURE');
  assert.equal(c.cwe, 'CWE-755');
  assert.equal(c.severity, 'HIGH');
  assert.equal(c.testingType, 'navigation');
});

check('Every 5xx (500/502/503/504) → SERVER_API_FAILURE / CWE-755 / CONFIRMED, never CWE-400', () => {
  for (const statusCode of [500, 502, 503, 504]) {
    const c = classifyFault({ faultType: 'NETWORK', message: `HTTP ${statusCode} GET /api/drop`, statusCode, scenario: 'NetworkSaboteur' });
    assert.equal(c.bugClass, 'SERVER_API_FAILURE', `status ${statusCode}`);
    assert.equal(c.cwe, 'CWE-755', `status ${statusCode}`);
    assert.notEqual(c.cwe, 'CWE-400', `status ${statusCode}`);
    assert.equal(c.confidence, 'CONFIRMED', `status ${statusCode}`);
    assert.equal(c.severity, 'HIGH', `status ${statusCode}`);
  }
});

check('Redirect loop during RouteTrasher → ROUTE_MUTATION_FAILURE', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'navigation failed',
    url: 'http://app/x',
    content: 'ERR_TOO_MANY_REDIRECTS',
    scenario: 'RouteTrasher',
  });
  assert.equal(c.bugClass, 'ROUTE_MUTATION_FAILURE');
  assert.equal(c.cwe, 'CWE-835');
});

check('Same redirect loop while idle → STRUCTURAL_NAVIGATION_LOGIC (scenario bias)', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'navigation failed',
    content: 'too many redirects',
  });
  // No scenario ⇒ Exploratory baseline, which expects navigation-logic (not route-mutation).
  assert.equal(c.bugClass, 'STRUCTURAL_NAVIGATION_LOGIC');
  assert.equal(c.scenario, 'Exploratory');
  assert.equal(c.testingType, 'exploratory');
});

check('Idle TypeError with no matching signal still classifies (regression)', () => {
  const c = classifyFault({
    faultType: 'EXCEPTION',
    message: 'Something unusual happened',
    content: 'no known signature here',
  });
  assert.equal(c.bugClass, 'RUNTIME_STABILITY_EXCEPTION');
  assert.equal(c.scenario, 'Exploratory');
  assert.ok(c.advice.length > 0, 'advice must be non-empty');
  assert.ok(c.cwe.startsWith('CWE-'), 'cwe must be a CWE id');
});

check('Client crash message during ButtonSpammer → RUNTIME_STABILITY_EXCEPTION', () => {
  const c = classifyFault({
    faultType: 'EXCEPTION',
    message: "Cannot read properties of undefined (reading 'x')",
    scenario: 'ButtonSpammer',
  });
  assert.equal(c.bugClass, 'RUNTIME_STABILITY_EXCEPTION');
  assert.equal(c.testingType, 'concurrency');
});

check('JSON-parse SyntaxError during ButtonSpammer → API_CONTRACT_VIOLATION (runtime signal beats scenario default)', () => {
  // The backend returned an HTML error page; the app's JSON.parse threw. The runtime
  // contract signal must own the verdict, not the concurrency scenario's default class.
  const c = classifyFault({
    faultType: 'EXCEPTION',
    message: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    scenario: 'ButtonSpammer',
  });
  assert.equal(c.bugClass, 'API_CONTRACT_VIOLATION');
  assert.equal(c.cwe, 'CWE-754');
  assert.equal(c.confidence, 'SIGNAL');
  assert.equal(c.testingType, 'concurrency');
});

check('A 5xx NETWORK body echoing a JSON.parse frame stays SERVER_API_FAILURE (contract signal is client-only)', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 500 GET /api/data',
    statusCode: 500,
    content: 'SyntaxError: Unexpected token < at JSON.parse (<anonymous>)',
    scenario: 'NetworkSaboteur',
  });
  assert.equal(c.bugClass, 'SERVER_API_FAILURE');
  assert.equal(c.severity, 'HIGH');
});

check('A generic build SyntaxError (no JSON signature) stays a plain runtime exception', () => {
  const c = classifyFault({
    faultType: 'EXCEPTION',
    message: 'SyntaxError: Unexpected end of input',
  });
  assert.equal(c.bugClass, 'RUNTIME_STABILITY_EXCEPTION');
});

check('No-signal fault under DataFuzzer must NOT be a security verdict (bias fix)', () => {
  // A real caught fault with no injection signal + no oracle confirmation must fall
  // back to the fault-type default, never the scenario's expected security bug.
  const c = classifyFault({
    faultType: 'CONSOLE',
    message: 'ResizeObserver loop limit exceeded',
    scenario: 'DataFuzzer',
  });
  assert.equal(c.bugClass, 'RUNTIME_STABILITY_EXCEPTION');
  assert.equal(c.confidence, 'INFERRED');
});

check('Oracle-confirmed injection under DataFuzzer → CONFIRMED security verdict', () => {
  const c = classifyFault({
    faultType: 'CONSOLE',
    message: 'reflected payload executed',
    content: '<script>window.__bgsf_xss("BGSF1_a")</script>',
    scenario: 'DataFuzzer',
    confirmed: true,
  });
  assert.equal(c.bugClass, 'FUZZ_VULNERABILITY_LEAK');
  assert.equal(c.confidence, 'CONFIRMED');
});

check('INFERRED runtime fault is severity-capped at MEDIUM', () => {
  // A no-signal exception classifies to RUNTIME_STABILITY_EXCEPTION (catalog HIGH) with
  // INFERRED confidence; the confidence cap lowers it to MEDIUM.
  const c = classifyFault({ faultType: 'EXCEPTION', message: 'Something unusual happened' });
  assert.equal(c.confidence, 'INFERRED');
  assert.equal(c.severity, 'MEDIUM');
});

check('Directly-observed HTTP 5xx is CONFIRMED (captured response is hard evidence)', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 500 GET /api/data', statusCode: 500, scenario: 'NetworkSaboteur' });
  assert.equal(c.bugClass, 'SERVER_API_FAILURE');
  assert.equal(c.confidence, 'CONFIRMED');
  assert.equal(c.severity, 'HIGH');
});

check('HTTP 5xx whose body/label echoes navigation text stays SERVER_API_FAILURE, never CWE-835', () => {
  // A 502 body echoing "failed to load"/"network error" (DEAD_END) or a redirect token
  // must not hijack the server error into a navigation verdict — CWE-835 is reserved for
  // genuine freezes/loops. Server error stays SERVER_API_FAILURE (CWE-755), CONFIRMED.
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 502 GET /api/orders',
    statusCode: 502,
    content: 'failed to load resource; too many redirects; page not found',
    scenario: 'Exploratory',
  });
  assert.equal(c.bugClass, 'SERVER_API_FAILURE');
  assert.equal(c.cwe, 'CWE-755');
  assert.equal(c.confidence, 'CONFIRMED');
});

check('HTTP 5xx leaking a server stack frame → SECURITY_VULNERABILITY_LEAK / CONFIRMED', () => {
  // Direct body evidence of information exposure is a more specific, equally-direct
  // verdict than the generic server error, so it still wins over BOUNDARY on a 5xx.
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 500 GET /api/data',
    statusCode: 500,
    content: 'Error\n    at handler (/srv/app/routes/data.js:42:11)',
    scenario: 'Exploratory',
  });
  assert.equal(c.bugClass, 'SECURITY_VULNERABILITY_LEAK');
  assert.equal(c.cwe, 'CWE-200');
  assert.equal(c.confidence, 'CONFIRMED');
});

check('HTTP 200 soft-fail (error payload) → API_CONTRACT_VIOLATION / CONFIRMED, not BOUNDARY', () => {
  // A 2xx whose body declares a failure is a masked contract break (an input/exception
  // fault), never resource exhaustion. Capturing the response is hard evidence ⇒ CONFIRMED.
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 200 POST /api/soft-fail',
    statusCode: 200,
    content: '{"success":false,"error":"validation failed"}',
    softFail: true,
    scenario: 'DataFuzzer',
  });
  assert.equal(c.bugClass, 'API_CONTRACT_VIOLATION');
  assert.equal(c.cwe, 'CWE-754');
  assert.equal(c.confidence, 'CONFIRMED');
  assert.equal(c.severity, 'HIGH');
  assert.ok(/error flag|error body|surface/i.test(c.advice), 'advice must match the error, not retries/timeouts');
});

check('HTTP 200 soft-fail leaking a server stack frame stays SECURITY_VULNERABILITY_LEAK', () => {
  // Direct body evidence of information exposure is a more specific, equally-direct verdict
  // than the generic contract break, so it still wins even on a masked 2xx.
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 200 GET /api/soft-fail',
    statusCode: 200,
    content: 'Error\n    at handler (/srv/app/routes/data.js:42:11)',
    softFail: true,
    scenario: 'Exploratory',
  });
  assert.equal(c.bugClass, 'SECURITY_VULNERABILITY_LEAK');
  assert.equal(c.confidence, 'CONFIRMED');
});

check('HTTP 200 soft-fail with a server-error body is NOT resource exhaustion (BOUNDARY)', () => {
  const c = classifyFault({
    faultType: 'NETWORK',
    message: 'HTTP 200 GET /api/soft-fail',
    statusCode: 200,
    content: 'Internal Server Error: something failed',
    softFail: true,
    scenario: 'NetworkSaboteur',
  });
  assert.equal(c.bugClass, 'API_CONTRACT_VIOLATION');
  assert.notEqual(c.bugClass, 'BOUNDARY_STRESS_FAILURE');
});

check('Determinism — same input yields identical classification', () => {
  const input = { faultType: 'NETWORK' as const, message: 'HTTP 503', statusCode: 503, scenario: 'NetworkSaboteur' };
  assert.deepEqual(classifyFault(input), classifyFault(input));
});

console.log(`\nAll ${passed} assertions passed.`);

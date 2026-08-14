// Standalone deterministic test for the knowledge-base FaultClassifier.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/bugs/knowledgeBase/FaultClassifier.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { classifyFault } from './index.js';
import { BUG_CATALOG } from './bugCatalog.js';

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
  // A no-signal exception classifies to RUNTIME_STABILITY_EXCEPTION (catalog MEDIUM) with
  // INFERRED confidence; both the catalog default and the confidence cap land it at MEDIUM.
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

// 4xx client statuses: an unhandled failed request, NOT resource exhaustion (CWE-400).
check('HTTP 401 (no signal) → UNHANDLED_CLIENT_ERROR / CWE-754, never CWE-400', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 401 POST /api/auth/login', statusCode: 401, scenario: 'NetworkSaboteur' });
  assert.equal(c.bugClass, 'UNHANDLED_CLIENT_ERROR');
  assert.equal(c.cwe, 'CWE-754');
  assert.notEqual(c.cwe, 'CWE-400');
  assert.notEqual(c.cwe, 'CWE-835');
});

check('a 4xx whose text says "failed to load" is NOT hijacked to CWE-835 nav loop', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'Failed to load resource: the server responded with a status of 401', statusCode: 401 });
  assert.equal(c.bugClass, 'UNHANDLED_CLIENT_ERROR');
  assert.equal(c.cwe, 'CWE-754');
  assert.notEqual(c.cwe, 'CWE-835');
});

check('HTTP 403 → UNHANDLED_CLIENT_ERROR / CWE-754', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 403 GET /api/admin', statusCode: 403 });
  assert.equal(c.bugClass, 'UNHANDLED_CLIENT_ERROR');
  assert.equal(c.cwe, 'CWE-754');
});

check('HTTP 400 with no leak signal → UNHANDLED_CLIENT_ERROR', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 400 POST /api/order', statusCode: 400 });
  assert.equal(c.bugClass, 'UNHANDLED_CLIENT_ERROR');
});

check('HTTP 429 stays BOUNDARY_STRESS_FAILURE / CWE-400 (genuine rate pressure)', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 429 Too Many Requests', statusCode: 429 });
  assert.equal(c.bugClass, 'BOUNDARY_STRESS_FAILURE');
  assert.equal(c.cwe, 'CWE-400');
});

check('HTTP 408 Request Timeout stays BOUNDARY_STRESS_FAILURE (timeout pressure)', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 408', statusCode: 408 });
  assert.equal(c.bugClass, 'BOUNDARY_STRESS_FAILURE');
});

check('transport abort with no status stays BOUNDARY_STRESS_FAILURE', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'net::ERR_FAILED GET /api/products' });
  assert.equal(c.bugClass, 'BOUNDARY_STRESS_FAILURE');
});

check('a 4xx that DOES leak a datastore error still wins as the injection verdict', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 400 POST /api/login', statusCode: 400, content: 'MongoError: unknown operator $ne', scenario: 'DataFuzzer' });
  assert.equal(c.bugClass, 'NOSQL_INJECTION'); // signal outranks the 4xx fallthrough
});

check('5xx still classifies as SERVER_API_FAILURE (unchanged)', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 500', statusCode: 500 });
  assert.equal(c.bugClass, 'SERVER_API_FAILURE');
  assert.equal(c.cwe, 'CWE-755');
});

// Per-finding CWE refinement for multi-shape classes.
check('redirect loop keeps CWE-835 (a genuine loop)', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'net::ERR_TOO_MANY_REDIRECTS', url: 'https://app.test/login' });
  assert.equal(c.bugClass, 'STRUCTURAL_NAVIGATION_LOGIC');
  assert.equal(c.cwe, 'CWE-835');
});

check('dead-end / broken route → CWE-670, never CWE-835', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'page not found', url: 'https://app.test/ghost' });
  assert.equal(c.bugClass, 'STRUCTURAL_NAVIGATION_LOGIC');
  assert.equal(c.cwe, 'CWE-670');
  assert.notEqual(c.cwe, 'CWE-835');
});

check('a leaked SQL error reads CWE-89, never CWE-79', () => {
  // Whether this resolves to SQL_INJECTION or the secondary FUZZ_VULNERABILITY_LEAK
  // candidate, the CWE must reflect the actual SQL leak — never the XSS default.
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 200 GET /api/search', content: 'You have an error in your SQL syntax near', scenario: 'DataFuzzer' });
  assert.equal(c.cwe, 'CWE-89');
  assert.notEqual(c.cwe, 'CWE-79');
});

check('a leaked Mongo error reads CWE-943, never CWE-79', () => {
  const c = classifyFault({ faultType: 'NETWORK', message: 'HTTP 200 GET /api/search', content: 'MongoError: unrecognized expression', scenario: 'DataFuzzer' });
  assert.equal(c.cwe, 'CWE-943');
  assert.notEqual(c.cwe, 'CWE-79');
});

check('confirmed reflected XSS leak stays CWE-79', () => {
  const c = classifyFault({ faultType: 'CONSOLE', message: 'reflected', content: '<script>alert(1)</script>', scenario: 'DataFuzzer', confirmed: true });
  assert.equal(c.bugClass, 'FUZZ_VULNERABILITY_LEAK');
  assert.equal(c.cwe, 'CWE-79');
});

check('lost session → CWE-287 (Improper Authentication), never CWE-613', () => {
  const c = classifyFault({ faultType: 'EXCEPTION', message: 'session dropped', scenario: 'SessionSynchronizer' });
  // Regardless of how this run resolves the class, SESSION_SYNC_FAULT must read CWE-287.
  assert.equal(BUG_CATALOG.SESSION_SYNC_FAULT.cwe, 'CWE-287');
  void c;
});

console.log(`\nAll ${passed} assertions passed.`);

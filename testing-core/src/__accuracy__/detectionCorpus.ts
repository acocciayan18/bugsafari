// ═══════════════════════════════════════════════════════════════
// __accuracy__/detectionCorpus.ts — LABELED FAULT-CLASSIFICATION GROUND TRUTH
// ═══════════════════════════════════════════════════════════════
// Deterministic, offline corpus for scoring FaultClassifier precision/recall.
// Each row is a caught fault (or a benign decoy) with the correct verdict.
//
// Two things are measured offline here (the browser-only reflection oracle is
// validated by testing/benchmark/xss-correlation.spec.ts instead):
//   1. Class accuracy — does classifyFault() resolve the right BugClass?
//   2. Security precision — a benign/uncorroborated fault must NOT be labelled a
//      security/injection bug just because a stress scenario was active
//      (the scenario confirmation-bias false-positive class that Fix B removes).

import type { FaultInput } from '../bugs/knowledgeBase/FaultClassifier.js';
import type { BugClass } from '../bugs/types.js';

export interface DetectionCase {
  /** Human-readable case name (shown in the metrics table on failure). */
  name: string;
  /** The caught fault fed to classifyFault(). */
  input: FaultInput;
  /** Correct BugClass, or 'NONE' when no specific class is asserted. */
  expected: BugClass | 'NONE';
  /** Whether a security/injection verdict is actually warranted for this fault. */
  expectSecurity: boolean;
}

/** BugClasses that constitute a "security/injection" verdict for precision scoring. */
export const SECURITY_CLASSES: ReadonlySet<BugClass> = new Set<BugClass>([
  'NOSQL_INJECTION',
  'SQL_INJECTION',
  'FUZZ_VULNERABILITY_LEAK',
  'SECURITY_VULNERABILITY_LEAK',
  'INPUT_SANITIZATION_FAILURE',
  'CLIENT_TRUST_BOUNDARY_VIOLATION',
]);

export const DETECTION_CORPUS: readonly DetectionCase[] = [
  // ── True faults: correct class must be recovered ────────────────────────────
  {
    name: 'client-crash: null property read',
    input: { faultType: 'EXCEPTION', message: "Cannot read properties of undefined (reading 'id')" },
    expected: 'RUNTIME_STABILITY_EXCEPTION',
    expectSecurity: false,
  },
  {
    name: 'client-crash: not a function',
    input: { faultType: 'CONSOLE', message: 'TypeError: handler is not a function' },
    expected: 'RUNTIME_STABILITY_EXCEPTION',
    expectSecurity: false,
  },
  {
    name: 'client-crash: stack overflow',
    input: { faultType: 'EXCEPTION', message: 'RangeError: Maximum call stack size exceeded' },
    expected: 'RUNTIME_STABILITY_EXCEPTION',
    expectSecurity: false,
  },
  {
    name: 'server-error: 500 internal',
    input: { faultType: 'NETWORK', message: '500 Internal Server Error', statusCode: 500 },
    expected: 'SERVER_API_FAILURE',
    expectSecurity: false,
  },
  {
    name: 'nosql: mongo operator leak (corroborated)',
    input: {
      faultType: 'NETWORK',
      message: 'Request failed',
      content: 'MongoError: unknown top level operator: $ne',
      scenario: 'DataFuzzer',
    },
    expected: 'NOSQL_INJECTION',
    expectSecurity: true,
  },
  {
    name: 'sql: leaked MySQL syntax error in a response body',
    input: {
      faultType: 'NETWORK',
      message: 'HTTP 500 POST /api/login',
      content: "You have an error in your SQL syntax; check the manual near ''' OR '1'='1' at line 1",
      statusCode: 500,
      scenario: 'DataFuzzer',
    },
    expected: 'SQL_INJECTION',
    expectSecurity: true,
  },
  {
    name: 'sql: leaked Postgres syntax error',
    input: {
      faultType: 'NETWORK',
      message: 'Request failed',
      content: 'error: syntax error at or near "OR"',
      statusCode: 500,
      scenario: 'DataFuzzer',
    },
    expected: 'SQL_INJECTION',
    expectSecurity: true,
  },
  {
    // A 500 whose body leaks a raw Mongo driver error is direct evidence, so it must
    // win over the generic SERVER_API_FAILURE verdict — the case F1 unblocks by reading
    // the failing-response body the StabilityMonitor previously skipped for status>=400.
    name: 'nosql: leaked Mongo driver error in a 500 body',
    input: {
      faultType: 'NETWORK',
      message: 'HTTP 500 POST /api/login-nosql',
      content: 'MongoError: unknown operator: $where in query',
      statusCode: 500,
      scenario: 'DataFuzzer',
    },
    expected: 'NOSQL_INJECTION',
    expectSecurity: true,
  },
  {
    name: 'redirect-loop (idle/exploratory)',
    input: { faultType: 'NETWORK', message: 'net::ERR_TOO_MANY_REDIRECTS', url: 'https://app.test/login' },
    // No active scenario ⇒ Exploratory baseline, which resolves a redirect loop to
    // navigation-logic (route-mutation is the RouteTrasher-scenario verdict).
    expected: 'STRUCTURAL_NAVIGATION_LOGIC',
    expectSecurity: false,
  },
  {
    name: 'query-mutation: undefined in route',
    input: { faultType: 'NETWORK', message: 'route error', url: 'https://app.test/#/user/undefined' },
    expected: 'ROUTE_MUTATION_FAILURE',
    expectSecurity: false,
  },
  {
    name: 'info-leak: server stack trace leaked in a 2xx body',
    input: {
      faultType: 'NETWORK',
      message: 'HTTP 200 GET /api/report',
      content: 'Error: ECONNREFUSED\n    at Object.<anonymous> (/srv/app/db.js:42:17)\n    at process._tickCallback (internal/process/next_tick.js:68:7)',
      statusCode: 200,
    },
    expected: 'SECURITY_VULNERABILITY_LEAK',
    expectSecurity: true,
  },
  {
    name: 'xss: reflected + confirmed by oracle',
    input: {
      faultType: 'CONSOLE',
      message: 'reflected payload executed',
      content: '<script>window.__bgsf_xss("BGSF12_ab")</script>',
      scenario: 'DataFuzzer',
      confirmed: true,
    },
    expected: 'FUZZ_VULNERABILITY_LEAK',
    expectSecurity: true,
  },

  // ── Benign decoys: scenario confirmation-bias false positives (Fix B target) ─
  // Each is a real caught fault with NO injection signal, fired while the security
  // DataFuzzer scenario is active. The old classifier falls back to the scenario's
  // primary expected bug (FUZZ_VULNERABILITY_LEAK) → a security false positive.
  {
    name: 'benign: ResizeObserver console noise under data-fuzz',
    input: {
      faultType: 'CONSOLE',
      message: 'ResizeObserver loop limit exceeded',
      scenario: 'DataFuzzer',
    },
    expected: 'RUNTIME_STABILITY_EXCEPTION',
    expectSecurity: false, // no signal + no confirmation ⇒ must NOT be a security verdict
  },
  {
    name: 'benign: generic render exception under data-fuzz',
    input: {
      faultType: 'EXCEPTION',
      message: 'Something went wrong during render',
      scenario: 'DataFuzzer',
    },
    expected: 'RUNTIME_STABILITY_EXCEPTION',
    expectSecurity: false, // stability crash, not an injection leak
  },
  {
    name: 'benign: slow network under data-fuzz (no injection signal)',
    input: {
      faultType: 'NETWORK',
      message: 'net::ERR_TIMED_OUT',
      scenario: 'DataFuzzer',
    },
    expected: 'BOUNDARY_STRESS_FAILURE',
    expectSecurity: false,
  },
  {
    // A 4xx client status is the app failing to handle a failed request (CWE-754), not
    // resource exhaustion (CWE-400) and not a navigation loop (CWE-835).
    name: 'unhandled 401 under NetworkSaboteur → UNHANDLED_CLIENT_ERROR',
    input: {
      faultType: 'NETWORK',
      message: 'HTTP 401 POST /api/auth/login',
      statusCode: 401,
      scenario: 'NetworkSaboteur',
    },
    expected: 'UNHANDLED_CLIENT_ERROR',
    expectSecurity: false,
  },
  {
    // A 5xx error page whose body merely echoes a <script> tag is NOT a confirmed XSS:
    // raw tag-presence without the execution oracle is not proof of an executable
    // reflection. Pre-fix this classified as FUZZ_VULNERABILITY_LEAK (security FP);
    // XSS_REFLECTION is now oracle-gated on every fault type, so it falls to the
    // server-error verdict for the 5xx.
    name: 'benign: unconfirmed <script> echoed in a 5xx body under data-fuzz',
    input: {
      faultType: 'NETWORK',
      message: 'HTTP 500 POST /api/search',
      content: '<div class="error">Internal error</div><script>alert(1)</script>',
      statusCode: 500,
      scenario: 'DataFuzzer',
    },
    expected: 'SERVER_API_FAILURE',
    expectSecurity: false,
  },
];

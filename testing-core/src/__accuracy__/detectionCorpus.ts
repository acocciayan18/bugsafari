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
  'FUZZ_VULNERABILITY_LEAK',
  'SECURITY_VULNERABILITY_LEAK',
  'INPUT_SANITIZATION_FAILURE',
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
    expected: 'BOUNDARY_STRESS_FAILURE',
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
];

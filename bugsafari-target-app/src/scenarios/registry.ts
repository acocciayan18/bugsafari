import type { ComponentType } from 'react';
import JsRuntimeErrors from '../pages/JsRuntimeErrors';
import NetworkErrors from '../pages/NetworkErrors';
import ApiHang from '../pages/ApiHang';
import DuplicateActions from '../pages/DuplicateActions';
import StateRaces from '../pages/StateRaces';
import UiFreeze from '../pages/UiFreeze';
import ConstraintBypass from '../pages/ConstraintBypass';
import InputFuzzing from '../pages/InputFuzzing';
import XssInjection from '../pages/XssInjection';
import SqlInjection from '../pages/SqlInjection';
import NoSqlInjection from '../pages/NoSqlInjection';
import Accessibility from '../pages/Accessibility';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Category = 'Runtime' | 'Network' | 'State' | 'Navigation' | 'Security' | 'Accessibility';

export interface Scenario {
  slug: string;
  title: string;
  category: Category;
  bugClass: string;
  cwe: string;
  expectedSeverity: Severity;
  detector: string;
  summary: string;
  reproduction: string;
  component: ComponentType;
}

export const SCENARIOS: Scenario[] = [
  {
    slug: 'js-runtime-errors',
    title: 'JavaScript Runtime Errors',
    category: 'Runtime',
    bugClass: 'RUNTIME_STABILITY_EXCEPTION',
    cwe: 'CWE-248',
    expectedSeverity: 'HIGH',
    detector: 'RuntimeStabilityFinder',
    summary: 'Uncaught exceptions, unhandled rejections and console errors across every runtime subtype.',
    reproduction: 'Click any error button; the thrown error surfaces via pageerror / unhandledrejection.',
    component: JsRuntimeErrors
  },
  {
    slug: 'network-errors',
    title: 'Network & Backend Failures',
    category: 'Network',
    bugClass: 'RUNTIME_STABILITY_EXCEPTION',
    cwe: 'CWE-248',
    expectedSeverity: 'HIGH',
    detector: 'StabilityMonitor.attachNetworkMonitoring',
    summary: '5xx server error, a soft-fail 2xx body masking an error, and a transport-level failure.',
    reproduction: 'Trigger each button; the engine sees HTTP 500, an error body behind 200, or a dropped connection.',
    component: NetworkErrors
  },
  {
    slug: 'api-hang',
    title: 'Infinite Loading / API Hang',
    category: 'Network',
    bugClass: 'INFINITE_LOADING',
    cwe: 'CWE-400',
    expectedSeverity: 'HIGH',
    detector: 'ApiHangFinder',
    summary: 'A request that never resolves leaves the spinner on screen forever.',
    reproduction: 'Click "Load profile"; the request hangs and the spinner persists past both probes.',
    component: ApiHang
  },
  {
    slug: 'duplicate-actions',
    title: 'Duplicate Actions / Double Submit',
    category: 'State',
    bugClass: 'SPA_STATE_RACE_CONDITION',
    cwe: 'CWE-362',
    expectedSeverity: 'MEDIUM',
    detector: 'DuplicateActionFinder',
    summary: 'Un-debounced button fires identical state-changing requests; a guarded variant returns 409.',
    reproduction: 'Double-click "Pay now"; two identical POSTs settle 2xx with no client guard.',
    component: DuplicateActions
  },
  {
    slug: 'state-races',
    title: 'SPA State Races',
    category: 'State',
    bugClass: 'SPA_STATE_RACE_CONDITION',
    cwe: 'CWE-362',
    expectedSeverity: 'MEDIUM',
    detector: 'DuplicateActionFinder',
    summary: 'Unguarded read-modify-write: overlapping increments read the same base and write the same value, losing an update.',
    reproduction: 'Rapidly click "Increment (unguarded)"; overlapping POST /api/counter writes collide and one increment is lost.',
    component: StateRaces
  },
  {
    slug: 'ui-freeze',
    title: 'Main-thread Freeze',
    category: 'Runtime',
    bugClass: 'CLIENT_RENDER_FREEZE',
    cwe: 'CWE-835',
    expectedSeverity: 'HIGH',
    detector: 'heartbeat stabilityMonitor',
    summary: 'A synchronous long task blocks the main thread past the heartbeat timeout.',
    reproduction: 'Click "Freeze UI"; the thread blocks and the 2s heartbeat misses for over 5s.',
    component: UiFreeze
  },
  {
    slug: 'constraint-bypass',
    title: 'Client-side Constraint Bypass',
    category: 'Security',
    bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
    cwe: 'CWE-602',
    expectedSeverity: 'HIGH',
    detector: 'constraintBypassFinder / FormBypasser',
    summary: 'Validation lives only in the DOM; stripping it and submitting still succeeds server-side.',
    reproduction: 'Strip required/maxlength/disabled and submit; POST /api/profile returns 200 regardless.',
    component: ConstraintBypass
  },
  {
    slug: 'input-fuzzing',
    title: 'Input Boundary Stress / Backend Crash',
    category: 'Security',
    bugClass: 'SERVER_API_FAILURE',
    cwe: 'CWE-755',
    expectedSeverity: 'HIGH',
    detector: 'DataFuzzer strategies + StabilityMonitor (5xx)',
    summary: 'Boundary or malformed payloads in typed inputs crash the backend into a 5xx server error.',
    reproduction: 'Submit an out-of-range number or malformed JSON; POST /api/compute returns 500.',
    component: InputFuzzing
  },
  {
    slug: 'xss-injection',
    title: 'Reflected XSS',
    category: 'Security',
    bugClass: 'FUZZ_VULNERABILITY_LEAK',
    cwe: 'CWE-79',
    expectedSeverity: 'CRITICAL',
    detector: 'reflectionOracle',
    summary: 'A search term is reflected raw and rendered as HTML, so injected markup executes.',
    reproduction: 'Search an onerror/script payload; the reflected markup runs and the oracle witnesses it.',
    component: XssInjection
  },
  {
    slug: 'sql-injection',
    title: 'SQL Injection',
    category: 'Security',
    bugClass: 'SQL_INJECTION',
    cwe: 'CWE-89',
    expectedSeverity: 'CRITICAL',
    detector: 'injectionDifferentialFinder + SQL_ERROR signals',
    summary: 'A tautology widens the query; a malformed payload leaks a SQL driver error.',
    reproduction: "Login with ' OR '1'='1; benign creds 401 but the payload returns 200 widened data.",
    component: SqlInjection
  },
  {
    slug: 'nosql-injection',
    title: 'NoSQL Injection',
    category: 'Security',
    bugClass: 'NOSQL_INJECTION',
    cwe: 'CWE-943',
    expectedSeverity: 'CRITICAL',
    detector: 'noSqlInjectionFinder + injectionDifferentialFinder',
    summary: 'Query operators survive into the datastore, bypassing auth or leaking a MongoError.',
    reproduction: 'Login with {"$ne":null}; auth is bypassed at 200 where the benign value failed.',
    component: NoSqlInjection
  },
  {
    slug: 'accessibility',
    title: 'Accessibility (WCAG 2.1)',
    category: 'Accessibility',
    bugClass: 'WCAG',
    cwe: 'WCAG-2.1',
    expectedSeverity: 'MEDIUM',
    detector: 'AccessibilityAuditor',
    summary: 'Seven structural WCAG violations on one route for the read-only DOM audit.',
    reproduction: 'Open the route; the auditor flags image-alt, form-label, control-name and more.',
    component: Accessibility
  }
];

export const CATEGORY_ORDER: Category[] = ['Runtime', 'Network', 'State', 'Navigation', 'Security', 'Accessibility'];

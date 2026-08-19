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
import InfoLeak from '../pages/InfoLeak';
import BrokenAccessControl from '../pages/BrokenAccessControl';
import SessionIntegrity from '../pages/SessionIntegrity';
import Accessibility from '../pages/Accessibility';
import BackNavStateLoss from '../pages/future/BackNavStateLoss';
import RouteMutation from '../pages/future/RouteMutation';
import CascadingNetwork from '../pages/future/CascadingNetwork';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Category = 'Runtime' | 'Network' | 'State' | 'Navigation' | 'Security' | 'Accessibility' | 'Future';

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
  detected: boolean;
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
    detected: true,
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
    detected: true,
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
    detected: true,
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
    detected: true,
    component: DuplicateActions
  },
  {
    slug: 'state-races',
    title: 'SPA State Races',
    category: 'State',
    bugClass: 'SPA_STATE_RACE_CONDITION',
    cwe: 'CWE-362',
    expectedSeverity: 'MEDIUM',
    detector: 'AsyncStateRacer / ButtonSpammer',
    summary: 'Async op interrupted mid-flight desyncs state or throws on a torn-down component.',
    reproduction: 'Start the async load then immediately reset; the stale resolve writes into a gone view.',
    detected: true,
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
    detected: true,
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
    detected: true,
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
    detected: true,
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
    detected: true,
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
    detected: true,
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
    detected: true,
    component: NoSqlInjection
  },
  {
    slug: 'info-leak',
    title: 'Security Information Leak',
    category: 'Security',
    bugClass: 'SECURITY_VULNERABILITY_LEAK',
    cwe: 'CWE-200',
    expectedSeverity: 'HIGH',
    detector: 'passive INFO_LEAK signals',
    summary: 'An error response exposes a stack trace and a database connection string.',
    reproduction: 'Trigger the failing report; GET /api/error-leak returns 500 with internal detail.',
    detected: true,
    component: InfoLeak
  },
  {
    slug: 'broken-access-control',
    title: 'Broken Access Control',
    category: 'Security',
    bugClass: 'CLIENT_TRUST_BOUNDARY_VIOLATION',
    cwe: 'CWE-602',
    expectedSeverity: 'CRITICAL',
    detector: 'storageTamper oracle',
    summary: 'Privileged UI unlocks from client-held role, and the server trusts that role too.',
    reproduction: 'Set role=admin in storage; the admin panel renders and GET /api/admin returns 2xx.',
    detected: true,
    component: BrokenAccessControl
  },
  {
    slug: 'session-integrity',
    title: 'Session Loss / Auth Desync',
    category: 'Security',
    bugClass: 'SESSION_SYNC_FAULT',
    cwe: 'CWE-613',
    expectedSeverity: 'HIGH',
    detector: 'SessionPreservationGuard',
    summary: 'A guarded action silently drops the session and bounces to the login route.',
    reproduction: 'Click "Save settings" while logged in; the token is wiped and the app lands on /login.',
    detected: true,
    component: SessionIntegrity
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
    detected: true,
    component: Accessibility
  },
  {
    slug: 'future/back-nav-state-loss',
    title: 'Back-navigation State Loss',
    category: 'Future',
    bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
    cwe: 'CWE-835',
    expectedSeverity: 'INFO',
    detector: '(none — no back-nav hook)',
    summary: 'history.back() lands on the wrong route; documented but not detected today.',
    reproduction: 'Open a modal then go back; the app exits to / instead of the list.',
    detected: false,
    component: BackNavStateLoss
  },
  {
    slug: 'future/route-mutation',
    title: 'Malformed Route Mutation',
    category: 'Future',
    bugClass: 'ROUTE_MUTATION_FAILURE',
    cwe: 'CWE-835',
    expectedSeverity: 'INFO',
    detector: '(none — RouteTrasher disabled)',
    summary: 'Query/history mutation breaks resolution; RouteTrasher is disabled engine-wide.',
    reproduction: 'Mutate the query to ?page=undefined; the view white-screens.',
    detected: false,
    component: RouteMutation
  },
  {
    slug: 'future/cascading-network',
    title: 'Cascading Network Failure',
    category: 'Future',
    bugClass: 'CASCADING_STATE_FAILURE',
    cwe: 'CWE-754',
    expectedSeverity: 'INFO',
    detector: '(throttling only — no finding)',
    summary: 'A burst of failures drives back-off throttling but emits no finding.',
    reproduction: 'Fire 5+ failing requests in 2s; the engine throttles but does not report.',
    detected: false,
    component: CascadingNetwork
  }
];

export const CATEGORY_ORDER: Category[] = ['Runtime', 'Network', 'State', 'Navigation', 'Security', 'Accessibility', 'Future'];

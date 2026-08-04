// ═══════════════════════════════════════════════════════════════
// knowledgeBase/bugCatalog.ts — CANONICAL BUG DEFINITIONS
// ═══════════════════════════════════════════════════════════════
// One authoritative entry per BugClass: human title, description, default
// severity, CWE identifier, and a copyable remediation snippet. This replaces
// the ad-hoc titles/severities scattered across the finder modules and the
// generic two-branch buildRemediation() in StabilityMonitor.

import type { BugClass } from '../types.js';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface BugDefinition {
  /** Short human-readable title shown on finding cards. */
  title: string;
  /** One-line explanation of the failure mode. */
  description: string;
  /** Severity applied when no stronger runtime signal (e.g. HTTP 5xx) overrides it. */
  defaultSeverity: Severity;
  /** MITRE CWE identifier for the vulnerability class. */
  cwe: string;
  /** Copyable remediation guidance, formatted as a plain checklist. */
  remediation: string;
}

function remediation(...lines: string[]): string {
  return lines.join('\n');
}

export const BUG_CATALOG: Record<BugClass, BugDefinition> = {
  INPUT_SANITIZATION_FAILURE: {
    title: 'Input sanitization failure',
    description: 'User-supplied input is reflected or processed without neutralizing dangerous characters.',
    defaultSeverity: 'MEDIUM',
    cwe: 'CWE-20',
    remediation: remediation(
      'Suggested remediation — input sanitization',
      '1. Validate and encode all user input on the server, not just the client',
      '2. Apply an allow-list for the expected format of this field',
      '3. Add a regression test asserting hostile payloads are rejected/escaped',
    ),
  },
  CLIENT_SIDE_CONSTRAINT_BYPASS: {
    title: 'Client-side constraint bypass',
    description: 'Validation enforced only in the browser (disabled/required/maxlength) can be stripped and bypassed.',
    defaultSeverity: 'MEDIUM',
    cwe: 'CWE-602',
    remediation: remediation(
      'Suggested remediation — server-side enforcement',
      '1. Re-validate every constraint on the server; never trust client state',
      '2. Reject requests whose values violate the documented contract',
      '3. Add a test that submits with client constraints removed and expects a 4xx',
    ),
  },
  NOSQL_INJECTION: {
    title: 'NoSQL injection',
    description: 'Query operators ($ne/$gt/$where/…) survive into the datastore query, enabling injection.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-943',
    remediation: remediation(
      'Suggested remediation — NoSQL injection',
      '1. Cast/validate input types before building queries; reject object-valued fields',
      '2. Use parameterized query builders and disable operator interpolation',
      '3. Add a test injecting {"$ne":""} and expecting a rejected request',
    ),
  },
  SQL_INJECTION: {
    title: 'SQL injection',
    description: 'User input is concatenated into a SQL statement, so an operator payload alters the query (auth bypass, data exposure, or a leaked SQL error).',
    defaultSeverity: 'CRITICAL',
    cwe: 'CWE-89',
    remediation: remediation(
      'Suggested remediation — SQL injection',
      '1. Use parameterized queries / prepared statements; never string-concatenate input into SQL',
      '2. Validate and type-cast input server-side; reject values that violate the column contract',
      "3. Stop returning raw SQL/driver errors to the client; log them server-side only",
      "4. Add a test submitting ' OR '1'='1 and expecting a rejected request (not a widened result set)",
    ),
  },
  SPA_STATE_RACE_CONDITION: {
    title: 'SPA state race condition',
    description: 'Concurrent interactions desynchronize component state or double-submit before guards apply.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-362',
    remediation: remediation(
      'Suggested remediation — race condition',
      '1. Debounce/disable the control after the first interaction until settled',
      '2. Guard state transitions to be idempotent under concurrent events',
      '3. Add a test firing a concurrent burst and asserting a single committed effect',
    ),
  },
  STRUCTURAL_NAVIGATION_LOGIC: {
    title: 'Structural navigation logic failure',
    description: 'Navigation produces redirect loops, dead-ends, or unreachable states.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-835',
    remediation: remediation(
      'Suggested remediation — navigation logic',
      '1. Bound redirect chains and detect cycles in the router guard',
      '2. Provide a valid fallback route for unresolved/unknown paths',
      '3. Add a test traversing history back/forward and asserting a stable route',
    ),
  },
  RUNTIME_STABILITY_EXCEPTION: {
    title: 'Runtime stability exception',
    description: 'An unhandled JavaScript exception or console error destabilized the page.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-248',
    remediation: remediation(
      'Suggested remediation — runtime exception',
      '1. Reproduce via the replication checklist above',
      '2. Wrap the failing operation in try/catch and add a null guard before it',
      '3. Add a regression test asserting the element/handler stays stable',
    ),
  },
  API_CONTRACT_VIOLATION: {
    title: 'Unhandled response exception / API contract violation',
    description: 'The app assumed a JSON response but received HTML/non-JSON (an error or proxy page), so parsing threw an unhandled exception instead of surfacing the failure.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-754',
    remediation: remediation(
      'Suggested remediation — API contract violation',
      '1. Check response.ok and the Content-Type before calling response.json(); handle non-JSON bodies explicitly',
      '2. Wrap the parse in try/catch and render an error/retry state instead of letting SyntaxError bubble',
      '3. Fix the endpoint so failures return structured JSON (not an HTML error page) with the right status',
      '4. Add a test that returns a non-JSON body and asserts the UI shows an error rather than crashing',
    ),
  },
  BOUNDARY_STRESS_FAILURE: {
    title: 'Boundary / network stress failure',
    description: 'The app failed under delayed, aborted, or error-status network conditions (5xx / timeout / freeze).',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-400',
    remediation: remediation(
      'Suggested remediation — network/server fault',
      '1. Verify endpoint health and the response for the failing call',
      '2. Add retry-with-backoff plus a user-facing error and timeout state',
      '3. Guard the call site against null / slow / aborted responses',
    ),
  },
  FUZZ_VULNERABILITY_LEAK: {
    title: 'Fuzz vulnerability leak',
    description: 'A fuzzing payload bypassed defenses — reflected XSS, raw NoSQL error, or server crash trace surfaced.',
    defaultSeverity: 'CRITICAL',
    cwe: 'CWE-79',
    remediation: remediation(
      'Suggested remediation — vulnerability leak',
      '1. Escape output and neutralize the reflected payload at the sink',
      '2. Stop leaking raw datastore/server errors to the client response',
      '3. Add a test asserting the payload is neither reflected nor errors the backend',
    ),
  },
  SECURITY_VULNERABILITY_LEAK: {
    title: 'Security information leak',
    description: 'Sensitive detail (stack trace, secret, datastore error) was exposed to the client.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-200',
    remediation: remediation(
      'Suggested remediation — information exposure',
      '1. Return generic error messages; log details server-side only',
      '2. Strip stack traces, file paths, and secrets from client responses',
      '3. Add a test asserting error responses contain no internal detail',
    ),
  },
  CASCADING_STATE_FAILURE: {
    title: 'Cascading state failure',
    description: 'A fault in one action propagated to fail a subsequent, otherwise-valid action.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-754',
    remediation: remediation(
      'Suggested remediation — cascading failure',
      '1. Isolate action side-effects so one failure cannot corrupt shared state',
      '2. Check for unusual/error conditions before dependent actions proceed',
      '3. Add a test that fails the first action and asserts the second still recovers',
    ),
  },
  ROUTE_MUTATION_FAILURE: {
    title: 'Route mutation failure',
    description: 'History/query mutation produced a redirect loop, component-resolution failure, or malformed route.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-835',
    remediation: remediation(
      'Suggested remediation — route mutation',
      '1. Validate and normalize query params before the router consumes them',
      '2. Bound redirects and handle unresolved components with a fallback',
      '3. Add a test mutating the URL and asserting a stable, resolvable route',
    ),
  },
  CLIENT_TRUST_BOUNDARY_VIOLATION: {
    title: 'Client-trusted auth state (broken access control)',
    description: 'The client granted privileged UI/routes purely from tampered client state (localStorage/sessionStorage/JWT claims) without server-side authorization.',
    defaultSeverity: 'CRITICAL',
    cwe: 'CWE-602',
    remediation: remediation(
      'Suggested remediation — client-side access control',
      '1. Never derive authorization from client storage; treat localStorage/JWT claims as untrusted input',
      '2. Enforce every privileged view/route/action server-side and verify JWT signatures (reject alg=none)',
      '3. Add a test that forges role=admin in client storage and asserts the server still denies access',
    ),
  },
  INFINITE_LOADING: {
    title: 'Unhandled API failure / infinite loading',
    description: 'An API request failed or never resolved and the UI stayed stuck in a loading state with no error/timeout fallback.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-400',
    remediation: remediation(
      'Suggested remediation — infinite loading',
      '1. Add a request timeout (AbortController/axios timeout) so a hung call cannot pend forever',
      '2. Render an error/retry state on failure instead of leaving the spinner up',
      '3. Clear the loading flag in a finally block so every path (success/error) exits loading',
    ),
  },
  CLIENT_RENDER_FREEZE: {
    title: 'Client render loop / frozen view',
    description: 'The DOM never stopped mutating (or the renderer stopped responding), so the view never reached a stable state.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-835',
    remediation: remediation(
      'Suggested remediation — render loop / frozen view',
      '1. Check for a state update inside render/useEffect with no dependency guard (setState → render → setState)',
      '2. Look for a subscription or observer that re-adds nodes on every mutation (toasts, live feeds, infinite scroll)',
      '3. Memoize derived values so a new object identity per render cannot retrigger the effect',
      '4. Move long synchronous work off the main thread so the view can paint',
    ),
  },
  SESSION_SYNC_FAULT: {
    title: 'Session synchronization fault',
    description: 'The authenticated session was lost mid-exploration — a control or redirect bounced the app back to a login page without an explicit sign-out.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-613',
    remediation: remediation(
      'Suggested remediation — session synchronization',
      '1. Keep the session token valid across in-app navigation; avoid unintended redirects to login',
      '2. Refresh/renew the session before expiry instead of forcing a re-login mid-flow',
      '3. Add a test that navigates the authenticated surface and asserts no bounce to the login page',
    ),
  },
};

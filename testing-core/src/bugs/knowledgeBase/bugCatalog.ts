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
    title: 'Input was not cleaned before use',
    description: 'The app showed or processed what a user typed without removing dangerous characters first, so a crafted value can change how the page behaves.',
    defaultSeverity: 'MEDIUM',
    cwe: 'CWE-20',
    remediation: remediation(
      'Suggested fix: clean and check user input',
      '1. Validate and encode every user input on the server, not just in the browser',
      '2. Accept only the format this field expects (an allow-list) and reject the rest',
      '3. Add a test that sends a hostile value and confirms it is rejected or escaped',
    ),
  },
  CLIENT_SIDE_CONSTRAINT_BYPASS: {
    title: 'Form rules are only checked in the browser',
    description: 'A rule like required, disabled, or maxlength is enforced only in the browser, so anyone can remove it and send a value the app should have refused.',
    defaultSeverity: 'MEDIUM',
    cwe: 'CWE-602',
    remediation: remediation(
      'Suggested fix: re-check every rule on the server',
      '1. Re-validate every field rule on the server and never trust what the browser sends',
      '2. Reject any request whose values break the documented rules',
      '3. Add a test that submits with the browser rules removed and expects a 4xx response',
    ),
  },
  NOSQL_INJECTION: {
    title: 'Database query accepted injected operators',
    description: 'Special query operators ($ne, $gt, $where, and similar) reached the database untouched, letting an attacker change what the query returns.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-943',
    remediation: remediation(
      'Suggested fix: stop query operators from reaching the database',
      '1. Check and cast input types before building a query, and reject fields that arrive as objects',
      '2. Use parameterized query builders and turn off operator interpolation',
      '3. Add a test that injects {"$ne":""} and expects the request to be rejected',
    ),
  },
  SQL_INJECTION: {
    title: 'Database query built from raw user input',
    description: 'User input was placed directly into a SQL statement, so a crafted value can change the query itself. This can bypass login, expose data, or leak a raw SQL error.',
    defaultSeverity: 'CRITICAL',
    cwe: 'CWE-89',
    remediation: remediation(
      'Suggested fix: never build SQL from raw input',
      '1. Use parameterized queries or prepared statements and never join input into SQL text',
      '2. Validate and cast input on the server, and reject values that break the column rules',
      "3. Stop sending raw SQL or driver errors to the browser, and log them on the server only",
      "4. Add a test that submits ' OR '1'='1 and expects a rejected request, not a wider result",
    ),
  },
  SPA_STATE_RACE_CONDITION: {
    title: 'Fast repeated actions corrupted the page state',
    description: 'Interactions that fired at the same time got out of sync, or a control submitted twice before its guard kicked in.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-362',
    remediation: remediation(
      'Suggested fix: guard against overlapping actions',
      '1. Disable or debounce the control after the first interaction until it finishes',
      '2. Make each state change safe to run more than once under overlapping events',
      '3. Add a test that fires a fast burst and confirms only one result is committed',
    ),
  },
  STRUCTURAL_NAVIGATION_LOGIC: {
    title: 'Navigation got stuck or led nowhere',
    description: 'Moving through the app produced a redirect loop, a dead end, or a screen that cannot be reached.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-835',
    remediation: remediation(
      'Suggested fix: make navigation always resolve',
      '1. Limit how many redirects can chain and detect loops in the router guard',
      '2. Send unknown or unresolved paths to a valid fallback screen',
      '3. Add a test that goes back and forward through history and expects a stable screen',
    ),
  },
  RUNTIME_STABILITY_EXCEPTION: {
    title: 'The page hit an unhandled error',
    description: 'A JavaScript error or console error was thrown and never caught, which left the page unstable.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-248',
    remediation: remediation(
      'Suggested fix: catch and guard the failing code',
      '1. Reproduce the fault using the replay checklist above',
      '2. Wrap the failing operation in try/catch and add a null check before it runs',
      '3. Add a test that confirms the element or handler stays stable',
    ),
  },
  API_CONTRACT_VIOLATION: {
    title: 'Server reply did not match the expected contract',
    description: 'The reply broke the contract the app relied on — either a non-JSON body (an HTML error or proxy page) where JSON was required, or a 200 success whose body actually declared an error. Either way the app read it as success and missed the real failure.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-754',
    remediation: remediation(
      'Suggested fix: verify the reply before trusting it',
      '1. Check response.ok, the HTTP status, and the Content-Type before calling response.json(), and handle non-JSON replies on purpose',
      '2. When the body carries its own error flag (error:true, success:false, status:"error"), treat it as a failure and surface it instead of showing success',
      '3. Fix the endpoint so real failures return the correct status (4xx/5xx) with proper JSON, not a 200 or an HTML error page',
      '4. Add a test that returns an error body and confirms the UI shows the failure instead of crashing or showing success',
    ),
  },
  SERVER_API_FAILURE: {
    title: 'The server returned an error',
    description: 'The backend answered with a server error (a 5xx such as 500, 502, 503, or 504), so the request could not complete. This is a failure in the server or an upstream gateway, not a browser problem.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-755',
    remediation: remediation(
      'Suggested fix: find and fix the failing server call',
      '1. Check the server logs for this endpoint and fix the error or the upstream/gateway it depends on',
      '2. Return a clear error to the browser and show a retry or error state instead of a broken screen',
      '3. Add health checks and a timeout on upstream calls so a bad gateway fails fast with a proper status',
      '4. Add a test that forces the endpoint to 5xx and confirms the UI shows an error, not a crash',
    ),
  },
  BOUNDARY_STRESS_FAILURE: {
    title: 'The app broke under resource pressure',
    description: 'The app failed under resource pressure — a request that was delayed, timed out, or cancelled, a hang, or too many requests at once. Reserved for resource exhaustion, not plain server errors.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-400',
    remediation: remediation(
      'Suggested fix: handle slow, cancelled, and overwhelming requests',
      '1. Add a request timeout and cancel in-flight calls that are superseded',
      '2. Add retry with backoff plus a visible error and timeout state for the user',
      '3. Guard the call site against empty, slow, or cancelled replies, and debounce bursts',
    ),
  },
  UNHANDLED_CLIENT_ERROR: {
    title: 'A failed request was not handled',
    description: 'A request came back with a client error (a 4xx such as 400, 401, 403, or 404) and the app did not handle it — no error state, retry, or redirect — so the interface was left broken or acted as if the call had succeeded. This is a client-side handling gap, not resource exhaustion or a server fault.',
    defaultSeverity: 'MEDIUM',
    cwe: 'CWE-754',
    remediation: remediation(
      'Suggested fix: handle failed responses on purpose',
      '1. Check response.ok / the HTTP status on every call and branch on failure, not only on success',
      '2. On 401/403 route to sign-in or an access-denied screen; on 400/404 show a clear error state instead of a broken view',
      '3. Add a test that returns a 4xx and confirms the UI shows an error rather than breaking or reporting success',
    ),
  },
  FUZZ_VULNERABILITY_LEAK: {
    title: 'A test payload got through a defense',
    description: 'A fuzzing payload slipped past the app defenses. It was reflected back as script (XSS), returned a raw database error, or produced a server crash trace.',
    defaultSeverity: 'CRITICAL',
    cwe: 'CWE-79',
    remediation: remediation(
      'Suggested fix: close the leak',
      '1. Escape output so the reflected payload can no longer run where it lands',
      '2. Stop returning raw database or server errors in the reply to the browser',
      '3. Add a test confirming the payload is neither reflected nor able to error the backend',
    ),
  },
  SECURITY_VULNERABILITY_LEAK: {
    title: 'The app exposed sensitive internal detail',
    description: 'Something private (a stack trace, a secret, or a database error) was sent back to the browser where anyone could read it.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-200',
    remediation: remediation(
      'Suggested fix: keep internal detail on the server',
      '1. Return a generic error message and log the details on the server only',
      '2. Remove stack traces, file paths, and secrets from anything sent to the browser',
      '3. Add a test confirming error replies contain no internal detail',
    ),
  },
  CASCADING_STATE_FAILURE: {
    title: 'One failure knocked out a later action',
    description: 'A fault in one action spread and caused a following, otherwise-valid action to fail too.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-754',
    remediation: remediation(
      'Suggested fix: stop failures from spreading',
      '1. Keep each action side-effect isolated so one failure cannot corrupt shared state',
      '2. Check for errors or odd conditions before a dependent action runs',
      '3. Add a test that fails the first action and confirms the second still recovers',
    ),
  },
  ROUTE_MUTATION_FAILURE: {
    title: 'Changing the URL broke the route',
    description: 'Editing the history or query values produced a redirect loop, a screen that failed to load, or a broken route.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-835',
    remediation: remediation(
      'Suggested fix: handle changed URLs safely',
      '1. Validate and normalize query values before the router uses them',
      '2. Limit redirects and send unresolved screens to a fallback',
      '3. Add a test that edits the URL and expects a stable, working route',
    ),
  },
  CLIENT_TRUST_BOUNDARY_VIOLATION: {
    title: 'Access was granted from browser data alone',
    description: 'The app unlocked privileged screens or routes based only on values stored in the browser (localStorage, sessionStorage, or JWT claims) that a user can edit, without checking with the server.',
    defaultSeverity: 'CRITICAL',
    cwe: 'CWE-602',
    remediation: remediation(
      'Suggested fix: check access on the server',
      '1. Never decide access from browser storage, and treat localStorage and JWT claims as untrusted input',
      '2. Enforce every privileged screen, route, and action on the server, and verify JWT signatures (reject alg=none)',
      '3. Add a test that forges role=admin in browser storage and confirms the server still denies access',
    ),
  },
  INFINITE_LOADING: {
    title: 'The screen stayed stuck loading',
    description: 'A request failed or never came back and the UI kept showing a loading spinner, with no error message or timeout to recover.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-400',
    remediation: remediation(
      'Suggested fix: give loading a way out',
      '1. Add a request timeout (AbortController or an axios timeout) so a stuck call cannot wait forever',
      '2. Show an error or retry screen on failure instead of leaving the spinner up',
      '3. Clear the loading flag in a finally block so both success and error paths stop loading',
    ),
  },
  CLIENT_RENDER_FREEZE: {
    title: 'The view kept redrawing and froze',
    description: 'The page never stopped updating (or the renderer stopped responding), so the view never settled into a stable state.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-835',
    remediation: remediation(
      'Suggested fix: break the redraw loop',
      '1. Look for a state update inside render or useEffect with no dependency guard (setState triggers render, which triggers setState again)',
      '2. Look for a subscription or observer that re-adds nodes on every change (toasts, live feeds, infinite scroll)',
      '3. Memoize derived values so a new object each render cannot keep retriggering the effect',
      '4. Move long synchronous work off the main thread so the view can paint',
    ),
  },
  SESSION_SYNC_FAULT: {
    title: 'The login session was lost mid-run',
    description: 'The signed-in session dropped during exploration. A control or redirect sent the app back to the login page even though no one signed out.',
    defaultSeverity: 'HIGH',
    cwe: 'CWE-613',
    remediation: remediation(
      'Suggested fix: keep the session alive',
      '1. Keep the session token valid across in-app navigation and avoid unwanted redirects to login',
      '2. Refresh the session before it expires instead of forcing a new login mid-flow',
      '3. Add a test that moves through the signed-in area and confirms no bounce back to login',
    ),
  },
};

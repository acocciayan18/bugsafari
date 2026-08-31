// Standalone deterministic tests for the Verify Fix verdict pipeline.
// Self-executing script (no runner configured): `npx tsx "src/domain/services/regression/regression.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { decideVerdict, confirmResolution, summarize, MIN_EXECUTED_RATIO } from './verdict.js';
import { FaultCollector, messagesSimilar, normalizeMessage } from './FaultCollector.js';
import { isReplayVerifiable } from './replayProbes.js';
import { detectApiContractViolation } from '../verification/apiContractBody.js';
import { stripNonRendered, classifyNavStatus } from './ReplaySession.js';
import { isAuthPage } from '../exploration/SessionPreservationGuard.js';
import type { ReplayStepStats } from '../../../../../shared/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const stats = (overrides: Partial<ReplayStepStats> = {}): ReplayStepStats => ({
  total: 4,
  executed: 4,
  skipped: 0,
  failed: 0,
  finalStepExecuted: true,
  ...overrides,
});
const signal = { faultType: 'EXCEPTION' as const, message: 'x' };

console.log('decideVerdict — evidence-gated verdict policy');

check('strong signal → STILL_ACTIVE even when every step skipped', () => {
  const d = decideVerdict({
    strong: [signal],
    weak: [],
    stats: stats({ executed: 0, skipped: 4, finalStepExecuted: false }),
    timelineSource: 'finding',
  });
  assert.equal(d.verdict, 'STILL_ACTIVE');
  assert.equal(d.reason, 'REPRODUCED');
});

check('weak-only match → INCONCLUSIVE, never STILL_ACTIVE or RESOLVED', () => {
  const d = decideVerdict({ strong: [], weak: [signal], stats: stats(), timelineSource: 'finding' });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'WEAK_MATCH_ONLY');
});

// Gap #4 transparency: the verdict stays INCONCLUSIVE (no logic change) but the
// operator-facing summary must state the still-active lean, not read as neutral.
check('weak-match summary states the still-active lean (unconfirmed, not fixed)', () => {
  const d = decideVerdict({ strong: [], weak: [signal], stats: stats(), timelineSource: 'finding' });
  const text = summarize(d, 'RUNTIME_STABILITY_EXCEPTION', stats()).toLowerCase();
  assert.ok(text.includes('still-active'));
  assert.ok(text.includes('unconfirmed'));
});

check('zero recorded steps → NO_REPLAY_STEPS (nothing to replay)', () => {
  const d = decideVerdict({
    strong: [],
    weak: [],
    stats: stats({ total: 0, executed: 0, finalStepExecuted: false }),
    timelineSource: 'finding',
  });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'NO_REPLAY_STEPS');
});

// The reported bug: a finding with no recorded timeline caught a bare page-load
// fault and read "STILL_ACTIVE reproduced after 0 steps". A strong signal with
// zero recorded steps is NOT attributable to the finding → INCONCLUSIVE.
check('strong signal but zero recorded steps → INCONCLUSIVE, never STILL_ACTIVE', () => {
  const d = decideVerdict({
    strong: [signal],
    weak: [],
    stats: stats({ total: 0, executed: 0, finalStepExecuted: false }),
    timelineSource: 'session',
  });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'NO_REPLAY_STEPS');
});

check(`executed ratio below ${MIN_EXECUTED_RATIO} → INSUFFICIENT_REPLAY`, () => {
  const d = decideVerdict({
    strong: [],
    weak: [],
    stats: stats({ total: 10, executed: 4, skipped: 6 }),
    timelineSource: 'finding',
  });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'INSUFFICIENT_REPLAY');
});

check('final (causal) step skipped → INSUFFICIENT_REPLAY even at high ratio', () => {
  const d = decideVerdict({
    strong: [],
    weak: [],
    stats: stats({ total: 4, executed: 3, skipped: 1, finalStepExecuted: false }),
    timelineSource: 'finding',
  });
  assert.equal(d.reason, 'INSUFFICIENT_REPLAY');
});

check('clean run on legacy session timeline → LEGACY_TIMELINE, not RESOLVED', () => {
  const d = decideVerdict({ strong: [], weak: [], stats: stats(), timelineSource: 'session' });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'LEGACY_TIMELINE');
});

check('clean fully-executed per-finding replay → RESOLVED', () => {
  const d = decideVerdict({ strong: [], weak: [], stats: stats(), timelineSource: 'finding' });
  assert.equal(d.verdict, 'RESOLVED');
  assert.equal(d.reason, 'CLEAN_REPLAY');
});

// A page navigation aborted mid-replay (e.g. ERR_ABORTED) ⇒ the faulting page never
// loaded, so a clean run is not proof of a fix — must be INCONCLUSIVE, not RESOLVED.
check('clean replay but a navigation aborted → INCOMPLETE_REPLAY, not RESOLVED', () => {
  const d = decideVerdict({ strong: [], weak: [], stats: stats(), timelineSource: 'finding', replayIncomplete: true });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'INCOMPLETE_REPLAY');
});

check('reproduction still wins over an incomplete replay (strong → STILL_ACTIVE)', () => {
  const d = decideVerdict({ strong: [signal], weak: [], stats: stats(), timelineSource: 'finding', replayIncomplete: true });
  assert.equal(d.verdict, 'STILL_ACTIVE');
});

check('clean replay that never hit the fault endpoint → INCONCLUSIVE, not RESOLVED', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultEndpoint: '/api/login', seenEndpoints: ['/'],
  });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'FAULT_TRIGGER_NOT_EXERCISED');
});

check('clean replay that DID re-hit the fault endpoint → RESOLVED', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultEndpoint: '/api/login', seenEndpoints: ['/', '/api/login'],
  });
  assert.equal(d.verdict, 'RESOLVED');
  assert.equal(d.reason, 'CLEAN_REPLAY');
});

check('reproduction still wins over the endpoint gate (strong signal → STILL_ACTIVE)', () => {
  const d = decideVerdict({
    strong: [signal], weak: [], stats: stats(), timelineSource: 'finding',
    faultEndpoint: '/api/login', seenEndpoints: ['/'],
  });
  assert.equal(d.verdict, 'STILL_ACTIVE');
});

console.log('decideVerdict — fault-location gate (non-network faults must reach the fault page)');

check('clean replay that ended on a different route → INCONCLUSIVE, not RESOLVED', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/checkout', finalUrlPath: '/login',
  });
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'FAULT_LOCATION_NOT_REACHED');
});

check('clean replay that ended on the recorded fault page → RESOLVED', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/checkout', finalUrlPath: '/checkout',
  });
  assert.equal(d.verdict, 'RESOLVED');
  assert.equal(d.reason, 'CLEAN_REPLAY');
});

// A deep-link fault page whose SPA shell shares the path prefix is the SAME surface —
// the prefix rule must not flag it as a different location.
check('a path that is a prefix of the recorded page counts as reached → RESOLVED', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/products/42', finalUrlPath: '/products',
  });
  assert.equal(d.verdict, 'RESOLVED');
});

check('reproduction still wins over the location gate (strong signal → STILL_ACTIVE)', () => {
  const d = decideVerdict({
    strong: [signal], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/a', finalUrlPath: '/b',
  });
  assert.equal(d.verdict, 'STILL_ACTIVE');
});

// Network faults leave faultUrlPath undefined (they use the endpoint gate), so the location
// gate self-disables and a clean re-exercised replay still resolves.
check('undefined faultUrlPath (network fault) disables the location gate → RESOLVED', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    finalUrlPath: '/somewhere-else',
  });
  assert.equal(d.verdict, 'RESOLVED');
});

check('a root fault/landing path never trips the location gate → RESOLVED', () => {
  assert.equal(decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/', finalUrlPath: '/dashboard',
  }).verdict, 'RESOLVED');
  assert.equal(decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/dashboard', finalUrlPath: '/',
  }).verdict, 'RESOLVED');
});

check('endpoint gate precedes the location gate when both would fire', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultEndpoint: '/api/x', seenEndpoints: ['/'],
    faultUrlPath: '/a', finalUrlPath: '/b',
  });
  assert.equal(d.reason, 'FAULT_TRIGGER_NOT_EXERCISED');
});

check('summarize(FAULT_LOCATION_NOT_REACHED) states the wrong-page cause, not the generic fallback', () => {
  const d = decideVerdict({
    strong: [], weak: [], stats: stats(), timelineSource: 'finding',
    faultUrlPath: '/checkout', finalUrlPath: '/login',
  });
  const text = summarize(d, 'RUNTIME_STABILITY_EXCEPTION', stats()).toLowerCase();
  assert.ok(text.includes('different page'));
  assert.ok(!text.includes('could not conclude'));
});

console.log('confirmResolution — a clean replay must be confirmed by a second');

const resolved = { verdict: 'RESOLVED' as const, reason: 'CLEAN_REPLAY' as const, matchedSignals: [] };
const stillActive = { verdict: 'STILL_ACTIVE' as const, reason: 'REPRODUCED' as const, matchedSignals: [signal] };
const inconclusive = { verdict: 'INCONCLUSIVE' as const, reason: 'INSUFFICIENT_REPLAY' as const, matchedSignals: [] };

check('retry reproduces the fault → STILL_ACTIVE (flaky bug is present)', () => {
  const d = confirmResolution(stillActive);
  assert.equal(d.verdict, 'STILL_ACTIVE');
});

check('retry also clean → RESOLVED confirmed', () => {
  const d = confirmResolution(resolved);
  assert.equal(d.verdict, 'RESOLVED');
  assert.equal(d.reason, 'CLEAN_REPLAY');
});

check('retry inconclusive → UNCONFIRMED_RESOLUTION, never RESOLVED', () => {
  const d = confirmResolution(inconclusive);
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'UNCONFIRMED_RESOLUTION');
});

check('retry could not run (null) → UNCONFIRMED_RESOLUTION, never RESOLVED', () => {
  const d = confirmResolution(null);
  assert.equal(d.verdict, 'INCONCLUSIVE');
  assert.equal(d.reason, 'UNCONFIRMED_RESOLUTION');
});

console.log('messagesSimilar — deterministic error-identity check');

check('same error with different quoted values still matches', () => {
  assert.ok(messagesSimilar('allProducts.filter is not a function', 'allProducts.filter is not a function'));
  assert.ok(messagesSimilar("Cannot read properties of undefined (reading 'items')", "Cannot read properties of undefined (reading 'cart')"));
});

check('unrelated errors do not match', () => {
  assert.ok(!messagesSimilar('allProducts.filter is not a function', 'theme token missing contrast ratio'));
});

check('normalizeMessage collapses digits and urls', () => {
  assert.equal(normalizeMessage('HTTP 500 at https://x.test/api/1'), normalizeMessage('HTTP 503 at https://y.test/api/2'));
});

console.log('FaultCollector.evaluate — tri-bucket layered matching');

const fakePage = { url: () => 'http://target.test/', on() {}, off() {} } as unknown as Page;
const collect = (): FaultCollector => new FaultCollector(fakePage);
// scanBodies=true: leak classes whose evidence is legitimately content/body-borne.
const collectBody = (): FaultCollector => new FaultCollector(fakePage, true);

check('signal-backed exact recurrence → strong', () => {
  const c = collect();
  c.addExternal({ faultType: 'EXCEPTION', message: 'allProducts.filter is not a function' });
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
  assert.equal(b.weak.length, 0);
});

check('unrelated console noise → other (does not block RESOLVED)', () => {
  const c = collect();
  c.addExternal({ faultType: 'CONSOLE', message: 'theme token missing contrast ratio' });
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent: '',
  });
  assert.equal(b.strong.length, 0);
  assert.equal(b.weak.length, 0);
  assert.equal(b.other.length, 1);
});

check('uncorroborated same-class pageerror → weak (blocks RESOLVED, not proof)', () => {
  const c = collect();
  c.addExternal({ faultType: 'EXCEPTION', message: 'worker task aborted unexpectedly' });
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent: '',
  });
  assert.equal(b.strong.length, 0);
  assert.equal(b.weak.length, 1);
});

check('CLIENT_SIDE_CONSTRAINT_BYPASS override (endpoint still accepted invalid) → strong', () => {
  const c = collect();
  c.addExternal({
    faultType: 'NETWORK',
    statusCode: 200,
    message: 'Constraint bypass reproduced: /backend/login.php accepted the invalid value (HTTP 200)',
    url: 'http://target.test/backend/login.php',
    bugClassOverride: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
  });
  const b = c.evaluate({
    originalBugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
    originalFaultType: 'NETWORK',
    originalMessage: 'POST /backend/login.php accepted the value (HTTP 200)',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
});

check('API_CONTRACT_VIOLATION override matching original → strong', () => {
  const c = collect();
  c.addExternal({
    faultType: 'NETWORK',
    statusCode: 200,
    message: 'API contract violation: HTML document returned where a JSON API response was expected',
    url: 'http://target.test/api/cart',
    bugClassOverride: 'API_CONTRACT_VIOLATION',
  });
  const b = c.evaluate({
    originalBugClass: 'API_CONTRACT_VIOLATION',
    originalFaultType: 'NETWORK',
    originalMessage: "Unexpected token '<' in JSON",
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
});

check('different-class fault → other, deduped', () => {
  const c = collect();
  c.addExternal({ faultType: 'NETWORK', message: 'HTTP 500 Internal Server Error', statusCode: 500, url: 'http://target.test/api/a' });
  c.addExternal({ faultType: 'NETWORK', message: 'HTTP 500 Internal Server Error', statusCode: 500, url: 'http://target.test/api/b' });
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent: '',
  });
  assert.equal(b.strong.length, 0);
  assert.equal(b.other.length, 1);
});

check('status code echoed in original message corroborates a same-class match', () => {
  const c = collect();
  c.addExternal({ faultType: 'NETWORK', message: 'HTTP 503 Service Unavailable', statusCode: 503 });
  const b = c.evaluate({
    originalBugClass: 'SERVER_API_FAILURE',
    originalFaultType: 'NETWORK',
    originalMessage: 'HTTP 503 Service Unavailable',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
});

check('body-borne Mongo leak → strong same-class NOSQL_INJECTION (still active)', () => {
  const c = collect();
  // Evidence lives only in the response body — the status line never names it.
  // Scenario is threaded exactly as the original finding carried it (DataFuzzer).
  c.addExternal({
    faultType: 'NETWORK',
    message: 'HTTP 500 Internal Server Error',
    statusCode: 500,
    content: 'MongoError: unknown top level operator: $where',
    url: 'http://target.test/api/users',
  });
  const b = c.evaluate({
    originalBugClass: 'NOSQL_INJECTION',
    originalFaultType: 'NETWORK',
    originalMessage: 'HTTP 500 Internal Server Error',
    scenario: 'DataFuzzer',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
});

check('body-borne SQL-driver leak → strong same-class SQL_INJECTION (still active)', () => {
  const c = collect();
  c.addExternal({
    faultType: 'NETWORK',
    message: 'HTTP 500 Internal Server Error',
    statusCode: 500,
    content: "You have an error in your SQL syntax near '' at line 1",
    url: 'http://target.test/api/search',
  });
  const b = c.evaluate({
    originalBugClass: 'SQL_INJECTION',
    originalFaultType: 'NETWORK',
    originalMessage: 'HTTP 500 Internal Server Error',
    scenario: 'DataFuzzer',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
});

check('body-borne stack leak → strong SECURITY_VULNERABILITY_LEAK (still active)', () => {
  const c = collect();
  c.addExternal({
    faultType: 'NETWORK',
    message: 'HTTP 500 Internal Server Error',
    statusCode: 500,
    content: 'Error: boom\n    at handler (/srv/app/routes/user.js:42:13)',
    url: 'http://target.test/api/profile',
  });
  const b = c.evaluate({
    originalBugClass: 'SECURITY_VULNERABILITY_LEAK',
    originalFaultType: 'NETWORK',
    originalMessage: 'HTTP 500 Internal Server Error',
    scenario: 'DataFuzzer',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
});

check('clean body (no leak) does not fabricate a NOSQL_INJECTION match', () => {
  const c = collect();
  c.addExternal({
    faultType: 'NETWORK',
    message: 'HTTP 200 OK',
    statusCode: 200,
    content: '{"users":[{"id":1,"name":"ok"}]}',
    url: 'http://target.test/api/users',
  });
  const b = c.evaluate({
    originalBugClass: 'NOSQL_INJECTION',
    originalFaultType: 'NETWORK',
    originalMessage: 'MongoError: unknown operator',
    scenario: 'DataFuzzer',
    pageContent: '',
  });
  assert.equal(b.strong.length, 0);
});

console.log('stripNonRendered — content scan must not match source code');

check('error-string literal inside an inline script is not scannable content', () => {
  const html = `<body><h1>Acme</h1><script>document.getElementById('x').addEventListener('click',()=>{console.error("TypeError: Cannot read properties of undefined (reading 'report')")})</script></body>`;
  const cleaned = stripNonRendered(html);
  assert.ok(!/cannot read propert/i.test(cleaned));
  assert.ok(/Acme/.test(cleaned));
});

check('a fault signature rendered into the visible DOM still survives stripping', () => {
  const html = `<body><div id="err">Internal Server Error</div><script>boot()</script></body>`;
  const cleaned = stripNonRendered(html);
  assert.ok(/internal server error/i.test(cleaned));
});

check('content scan on a page whose only signature lives in script source → no strong match', () => {
  const c = collect();
  const pageContent = stripNonRendered(`<body><h1>Acme</h1><script>console.error("is not a function")</script></body>`);
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent,
  });
  assert.equal(b.strong.length, 0);
});

console.log('FaultCollector — content scan is gated to leak classes (no false positives from rendered DOM text)');

// The core false-STILL_ACTIVE fix: for a non-leak class, error-like words RENDERED into the
// visible DOM ("is not a function", null/NaN/undefined) must never fabricate a strong signal —
// evidence for these classes is a real runtime fault, not page text.
check('rendered DOM error text for a runtime class (scanBodies=false) → no strong match', () => {
  const c = collect();
  const pageContent = `<body><h1>Docs</h1><p>x.filter is not a function — a null / undefined / NaN guide</p></body>`;
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent,
  });
  assert.equal(b.strong.length, 0);
  assert.equal(b.weak.length, 0);
});

// A genuine leaked SQL/Mongo error reflected into the DOM IS the evidence for a leak class,
// so body-scan classes must still scan content and reproduce.
check('reflected datastore-error text for a leak class (scanBodies=true) → strong match', () => {
  const c = collectBody();
  const pageContent = `<body><pre>You have an error in your SQL syntax near '' at line 1</pre></body>`;
  const b = c.evaluate({
    originalBugClass: 'SQL_INJECTION',
    originalFaultType: 'NETWORK',
    originalMessage: 'HTTP 500 Internal Server Error',
    scenario: 'DataFuzzer',
    pageContent,
  });
  assert.equal(b.strong.length, 1);
});

// The gate only silences PASSIVE DOM text — a real runtime fault (pageerror) for the same
// class is unaffected and still reproduces.
check('a real pageerror for a runtime class still reproduces despite the content gate → strong', () => {
  const c = collect();
  c.addExternal({ faultType: 'EXCEPTION', message: 'allProducts.filter is not a function' });
  const b = c.evaluate({
    originalBugClass: 'RUNTIME_STABILITY_EXCEPTION',
    originalFaultType: 'EXCEPTION',
    originalMessage: 'allProducts.filter is not a function',
    pageContent: `<body><p>is not a function</p></body>`,
  });
  assert.equal(b.strong.length, 1);
});

console.log('detectApiContractViolation — schema-level contract check');

check('declared JSON with valid JSON body → no violation', () => {
  assert.equal(detectApiContractViolation('application/json', '{"items":[]}').violation, false);
});

check('declared JSON with unparseable body → violation', () => {
  assert.ok(detectApiContractViolation('application/json; charset=utf-8', '<!doctype html><html></html>').violation);
});

check('full HTML document on an API call → violation (even with html content-type)', () => {
  assert.ok(detectApiContractViolation('text/html', '<!DOCTYPE html><html><body>Error</body></html>').violation);
});

check('HTML fragment (not a full document) → no violation', () => {
  assert.equal(detectApiContractViolation('text/html', '<div class="row">ok</div>').violation, false);
});

check('empty / whitespace body → no violation', () => {
  assert.equal(detectApiContractViolation('application/json', '   ').violation, false);
  assert.equal(detectApiContractViolation('application/json', '').violation, false);
});

check('valid JSON without a JSON content-type → no violation', () => {
  assert.equal(detectApiContractViolation('', '{"ok":true}').violation, false);
});

console.log('isReplayVerifiable — class gate');

check('replay-detectable classes verifiable; oracle/timing classes are not', () => {
  assert.ok(isReplayVerifiable('RUNTIME_STABILITY_EXCEPTION'));
  assert.ok(isReplayVerifiable('NOSQL_INJECTION'));
  assert.ok(isReplayVerifiable('SQL_INJECTION'));
  assert.ok(isReplayVerifiable('SECURITY_VULNERABILITY_LEAK'));
  // Verifiable via the endpoint-acceptance oracle: re-submit the invalid value and see
  // whether the server still accepts it (2xx) or now rejects it (4xx).
  assert.ok(isReplayVerifiable('CLIENT_SIDE_CONSTRAINT_BYPASS'));
  assert.ok(!isReplayVerifiable('SPA_STATE_RACE_CONDITION'));
  assert.ok(!isReplayVerifiable('CASCADING_STATE_FAILURE'));
  assert.ok(!isReplayVerifiable(''));
});

// Oracle-only classes were demoted: replay has no CONFIRMED reflected-XSS oracle
// (FUZZ/INPUT_SANITIZATION) and no StorageTamper oracle (CLIENT_TRUST), so verifying
// them from passive faults would fabricate RESOLVED. They must read as unverifiable.
check('oracle-only classes are demoted from the verifiable set', () => {
  assert.ok(!isReplayVerifiable('FUZZ_VULNERABILITY_LEAK'));
  assert.ok(!isReplayVerifiable('INPUT_SANITIZATION_FAILURE'));
  assert.ok(!isReplayVerifiable('CLIENT_TRUST_BOUNDARY_VIOLATION'));
});

console.log('classifyNavStatus — recorded-route reachability gate');

check('2xx/3xx and null (SPA same-document nav) are servable', () => {
  assert.equal(classifyNavStatus(200), 'ok');
  assert.equal(classifyNavStatus(204), 'ok');
  assert.equal(classifyNavStatus(302), 'ok');
  assert.equal(classifyNavStatus(null), 'ok');
});

check('4xx/5xx recorded route → ROUTE_CHANGED (result not comparable)', () => {
  assert.equal(classifyNavStatus(404), 'ROUTE_CHANGED');
  assert.equal(classifyNavStatus(410), 'ROUTE_CHANGED');
  assert.equal(classifyNavStatus(500), 'ROUTE_CHANGED');
});

console.log('isAuthPage — login-wall path detection (shared with the exploration guard)');

check('recognized auth paths are login walls', () => {
  assert.ok(isAuthPage('https://app.test/login'));
  assert.ok(isAuthPage('https://app.test/sign-in'));
  assert.ok(isAuthPage('https://app.test/auth/callback'));
  assert.ok(isAuthPage('https://idp.test/sso'));
});

check('non-auth surfaces are not login walls; a finding recorded on login is exempt', () => {
  assert.ok(!isAuthPage('https://app.test/dashboard'));
  assert.ok(!isAuthPage('https://app.test/cart?step=login'));
  // A finding captured ON the login page must not be refused as an auth wall: both
  // landed and recorded URLs are auth pages, so the replay guard's `landed && !recorded`
  // condition is false. Proven here at the predicate level.
  const recordedOnLogin = isAuthPage('https://app.test/login');
  assert.ok(recordedOnLogin && isAuthPage('https://app.test/login'));
});

console.log(`\nAll ${passed} regression-verdict checks passed.`);

// Standalone deterministic tests for the Verify Fix verdict pipeline.
// Self-executing script (no runner configured): `npx tsx "src/domain/services/regression/regression.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { decideVerdict, MIN_EXECUTED_RATIO } from './verdict.js';
import { FaultCollector, messagesSimilar, normalizeMessage } from './FaultCollector.js';
import { isReplayVerifiable } from './replayProbes.js';
import { stripNonRendered } from './ReplaySession.js';
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

check('zero recorded steps → INSUFFICIENT_REPLAY', () => {
  const d = decideVerdict({
    strong: [],
    weak: [],
    stats: stats({ total: 0, executed: 0, finalStepExecuted: false }),
    timelineSource: 'finding',
  });
  assert.equal(d.reason, 'INSUFFICIENT_REPLAY');
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

check('probe bugClassOverride matching original → strong', () => {
  const c = collect();
  c.addExternal({
    faultType: 'NETWORK',
    message: 'API hang: GET http://target.test/api pending > 8s',
    bugClassOverride: 'INFINITE_LOADING',
  });
  const b = c.evaluate({
    originalBugClass: 'INFINITE_LOADING',
    originalFaultType: 'NETWORK',
    originalMessage: 'stuck loading',
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
    originalBugClass: 'BOUNDARY_STRESS_FAILURE',
    originalFaultType: 'NETWORK',
    originalMessage: 'HTTP 503 Service Unavailable',
    pageContent: '',
  });
  assert.equal(b.strong.length, 1);
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

console.log('isReplayVerifiable — class gate');

check('replay-detectable classes verifiable; oracle/timing classes are not', () => {
  assert.ok(isReplayVerifiable('RUNTIME_STABILITY_EXCEPTION'));
  assert.ok(isReplayVerifiable('INFINITE_LOADING'));
  assert.ok(!isReplayVerifiable('SPA_STATE_RACE_CONDITION'));
  assert.ok(!isReplayVerifiable('CASCADING_STATE_FAILURE'));
  assert.ok(!isReplayVerifiable('CLIENT_SIDE_CONSTRAINT_BYPASS'));
  assert.ok(!isReplayVerifiable(''));
});

console.log(`\nAll ${passed} regression-verdict checks passed.`);

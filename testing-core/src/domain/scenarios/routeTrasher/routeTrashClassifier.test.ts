// Standalone deterministic tests for the centralized RouteTrasher three-tier
// classifier. No unit-test runner is configured in this package, so this is a
// self-executing script: run with
// `npx tsx src/domain/scenarios/routeTrasher/routeTrashClassifier.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  classifyHttpStatus,
  classifyClientAnomaly,
  classifyNavStep,
  isExpectedResourceNoise,
  isWhiteScreenFailure,
} from './routeTrashClassifier.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('routeTrashClassifier — three-tier severity classification');

// ── HTTP status tiers ────────────────────────────────────────────────────────

check('5xx → MEDIUM finding', () => {
  const v = classifyHttpStatus(500);
  assert.equal(v.severity, 'MEDIUM');
  assert.equal(v.createFinding, true);
  const v503 = classifyHttpStatus(503);
  assert.equal(v503.severity, 'MEDIUM');
  assert.equal(v503.createFinding, true);
});

check('defensive 4xx (400/401/403/404) → INFORMATIONAL, no finding', () => {
  for (const status of [400, 401, 403, 404, 405, 409, 422, 429]) {
    const v = classifyHttpStatus(status);
    assert.equal(v.severity, 'INFORMATIONAL', `status ${status}`);
    assert.equal(v.createFinding, false, `status ${status}`);
  }
});

check('2xx clean → INFORMATIONAL, no finding', () => {
  const v = classifyHttpStatus(200);
  assert.equal(v.severity, 'INFORMATIONAL');
  assert.equal(v.createFinding, false);
});

check('2xx with soft-fail body → MEDIUM finding (masked failure)', () => {
  const v = classifyHttpStatus(200, { softFailBody: true });
  assert.equal(v.severity, 'MEDIUM');
  assert.equal(v.createFinding, true);
});

check('classification is deterministic (same input ⇒ same verdict)', () => {
  assert.deepEqual(classifyHttpStatus(500), classifyHttpStatus(500));
  assert.deepEqual(classifyHttpStatus(404), classifyHttpStatus(404));
});

// ── Resource-noise filter ────────────────────────────────────────────────────

check('failed static-asset loads are expected noise (filtered)', () => {
  assert.equal(isExpectedResourceNoise('http://x/favicon.ico', 'other', 404), true);
  assert.equal(isExpectedResourceNoise('http://x/logo.png', 'image', 404), true);
  assert.equal(isExpectedResourceNoise('http://x/app.css', 'stylesheet', 404), true);
  assert.equal(isExpectedResourceNoise('http://x/bundle.js', 'script', 500), true);
});

check('real API (xhr/fetch) traffic is never noise', () => {
  assert.equal(isExpectedResourceNoise('http://x/api/users', 'fetch', 404), false);
  assert.equal(isExpectedResourceNoise('http://x/api/users', 'xhr', 500), false);
});

check('a successful asset load is not flagged as noise', () => {
  assert.equal(isExpectedResourceNoise('http://x/logo.png', 'image', 200), false);
});

// ── Client anomalies ─────────────────────────────────────────────────────────

check('uncaught page error / console error → CRITICAL; warning → INFORMATIONAL', () => {
  assert.equal(classifyClientAnomaly({ type: 'pageerror', text: 'boom' }), 'CRITICAL');
  assert.equal(classifyClientAnomaly({ type: 'error', text: 'boom' }), 'CRITICAL');
  assert.equal(classifyClientAnomaly({ type: 'warning', text: 'deprecated' }), 'INFORMATIONAL');
});

// ── White-screen detection ───────────────────────────────────────────────────

check('missing body or empty render → white-screen failure', () => {
  assert.equal(isWhiteScreenFailure({ visibleTextLength: 0, visibleElementCount: 0, hasBody: false }), true);
  assert.equal(isWhiteScreenFailure({ visibleTextLength: 0, visibleElementCount: 1, hasBody: true }), true);
});

check('a rendered page with content is not a white-screen', () => {
  assert.equal(isWhiteScreenFailure({ visibleTextLength: 42, visibleElementCount: 12, hasBody: true }), false);
  assert.equal(isWhiteScreenFailure({ visibleTextLength: 0, visibleElementCount: 8, hasBody: true }), false);
});

// ── Nav-step aggregation ─────────────────────────────────────────────────────

check('nav step with a 5xx → MEDIUM, creates finding', () => {
  const v = classifyNavStep({
    apiResponses: [{ url: 'http://x/api', status: 500, method: 'GET' }],
    consoleAnomalies: [],
  });
  assert.equal(v.severity, 'MEDIUM');
  assert.equal(v.serverErrors, 1);
  assert.equal(v.defensiveResponses, 0);
  assert.equal(v.createsFinding, true);
});

check('nav step with only 4xx → INFORMATIONAL, no finding', () => {
  const v = classifyNavStep({
    apiResponses: [
      { url: 'http://x/api/a', status: 404, method: 'GET' },
      { url: 'http://x/api/b', status: 403, method: 'POST' },
    ],
    consoleAnomalies: [],
  });
  assert.equal(v.severity, 'INFORMATIONAL');
  assert.equal(v.defensiveResponses, 2);
  assert.equal(v.serverErrors, 0);
  assert.equal(v.createsFinding, false);
});

check('client crash dominates: pageerror + 4xx + 5xx → CRITICAL', () => {
  const v = classifyNavStep({
    apiResponses: [
      { url: 'http://x/api/a', status: 404, method: 'GET' },
      { url: 'http://x/api/b', status: 500, method: 'POST' },
    ],
    consoleAnomalies: [
      { type: 'pageerror', text: 'Cannot read properties of undefined' },
      { type: 'warning', text: 'noise' },
    ],
  });
  assert.equal(v.severity, 'CRITICAL');
  assert.equal(v.clientCrashes, 1);
  assert.equal(v.serverErrors, 1);
  assert.equal(v.defensiveResponses, 1);
  assert.equal(v.createsFinding, true);
});

check('empty nav step → INFORMATIONAL, no finding', () => {
  const v = classifyNavStep({ apiResponses: [], consoleAnomalies: [] });
  assert.equal(v.severity, 'INFORMATIONAL');
  assert.equal(v.createsFinding, false);
});

console.log(`\nrouteTrashClassifier: ${passed} checks passed.`);

// Standalone deterministic test for the finding-verification pipeline.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx "src/domain/services/verification/verification.test.ts"`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { classifyFaultOrigin } from './faultOrigin.js';
import { scoreFinding } from './confidenceScore.js';
import { VerificationPipeline } from './VerificationPipeline.js';
import { detectSoftFailBody, isBodyReadableResourceType, MAX_SOFT_FAIL_BODY_BYTES } from './softFailBody.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('Verification pipeline — provenance + scoring + correlation');

// ── Provenance ──
check('browser-closed → PLAYWRIGHT artifact (not target app)', () => {
  const v = classifyFaultOrigin({ faultType: 'EXCEPTION', message: 'Target page, context or browser has been closed' });
  assert.equal(v.origin, 'PLAYWRIGHT');
  assert.equal(v.isTargetApp, false);
});

check('net::ERR_ABORTED → PLAYWRIGHT artifact', () => {
  const v = classifyFaultOrigin({ faultType: 'NETWORK', message: 'net::ERR_ABORTED', url: 'https://app.test/api/x' });
  assert.equal(v.isTargetApp, false);
});

check('DNS/connection failure → NETWORK_ENV', () => {
  const v = classifyFaultOrigin({ faultType: 'NETWORK', message: 'net::ERR_NAME_NOT_RESOLVED' });
  assert.equal(v.origin, 'NETWORK_ENV');
});

check("first-party connection refusal → TARGET_APP (the app's backend is down)", () => {
  const v = classifyFaultOrigin({
    faultType: 'NETWORK',
    message: 'Network Request Failed: net::ERR_CONNECTION_REFUSED',
    url: 'https://api.app.test/orders',
    targetOrigin: 'https://app.test',
  });
  assert.equal(v.origin, 'TARGET_APP');
  assert.equal(v.isTargetApp, true);
});

check('first-party request timeout → TARGET_APP (backend hung)', () => {
  const v = classifyFaultOrigin({
    faultType: 'NETWORK',
    message: 'Network Request Failed: net::ERR_TIMED_OUT',
    url: 'https://app.test/api/slow',
    targetOrigin: 'https://app.test',
  });
  assert.equal(v.origin, 'TARGET_APP');
});

check('third-party connection failure → NETWORK_ENV', () => {
  const v = classifyFaultOrigin({
    faultType: 'NETWORK',
    message: 'Network Request Failed: net::ERR_CONNECTION_RESET',
    url: 'https://cdn.vendor.io/track.js',
    targetOrigin: 'https://app.test',
  });
  assert.equal(v.origin, 'NETWORK_ENV');
});

check('third-party 5xx → NETWORK_ENV, not the app under test', () => {
  const v = classifyFaultOrigin({
    faultType: 'NETWORK',
    message: 'HTTP 503 GET https://analytics.vendor.io/collect',
    url: 'https://analytics.vendor.io/collect',
    statusCode: 503,
    targetOrigin: 'https://app.test',
  });
  assert.equal(v.origin, 'NETWORK_ENV');
});

check('app error text containing "cancelled" is NOT a harness abort', () => {
  const v = classifyFaultOrigin({
    faultType: 'EXCEPTION',
    message: 'Payment cancelled by upstream gateway: order left in PENDING',
  });
  assert.equal(v.origin, 'TARGET_APP');
});

check('app backend timeout wording is NOT a Playwright artifact', () => {
  const v = classifyFaultOrigin({
    faultType: 'NETWORK',
    message: 'HTTP 504 GET https://app.test/api/report — upstream timeout exceeded',
    url: 'https://app.test/api/report',
    statusCode: 504,
    targetOrigin: 'https://app.test',
  });
  assert.equal(v.origin, 'TARGET_APP');
});

check('soft-fail body: adjacency required, co-occurrence rejected', () => {
  assert.equal(detectSoftFailBody('{"error":null,"active":true}').softFail, false);
  assert.equal(detectSoftFailBody('{"error":true,"msg":"boom"}').softFail, true);
  assert.equal(detectSoftFailBody('{"success":false}').softFail, true);
  assert.equal(detectSoftFailBody('{"status":"fail"}').softFail, true);
  assert.equal(detectSoftFailBody('{"errors":[{"field":"email"}]}').softFail, true);
  assert.equal(detectSoftFailBody('{"errors":[]}').softFail, false);
});

check('soft-fail body: oversized payloads are not scanned', () => {
  const huge = `{"error":true}${'x'.repeat(MAX_SOFT_FAIL_BODY_BYTES)}`;
  assert.equal(detectSoftFailBody(huge).softFail, false);
});

check('only xhr/fetch bodies are read', () => {
  assert.equal(isBodyReadableResourceType('xhr'), true);
  assert.equal(isBodyReadableResourceType('fetch'), true);
  assert.equal(isBodyReadableResourceType('script'), false);
  assert.equal(isBodyReadableResourceType('document'), false);
});

check('ResizeObserver loop → BROWSER_EXTENSION noise', () => {
  const v = classifyFaultOrigin({ faultType: 'CONSOLE', message: 'ResizeObserver loop limit exceeded' });
  assert.equal(v.origin, 'BROWSER_EXTENSION');
});

check('cross-origin API failure (split frontend/backend deploy) is still TARGET_APP', () => {
  const v = classifyFaultOrigin({
    faultType: 'NETWORK',
    message: 'HTTP 500 GET https://api.app.test/orders',
    url: 'https://api.app.test/orders',
    statusCode: 500,
  });
  assert.equal(v.origin, 'TARGET_APP');
  assert.equal(v.isTargetApp, true);
});

check('real app JS exception → TARGET_APP', () => {
  const v = classifyFaultOrigin({ faultType: 'EXCEPTION', message: "Cannot read properties of undefined (reading 'id')" });
  assert.equal(v.origin, 'TARGET_APP');
  assert.equal(v.isTargetApp, true);
});

// ── Scoring ──
check('CONFIRMED oracle + target + corroborated → CONFIRMED status', () => {
  const r = scoreFinding({ confidence: 'CONFIRMED', origin: 'TARGET_APP', evidenceCompleteness: 1, corroborated: true });
  assert.equal(r.status, 'CONFIRMED');
  assert.ok(r.score >= 0.8);
});

check('lone INFERRED target fault → not CONFIRMED', () => {
  const r = scoreFinding({ confidence: 'INFERRED', origin: 'TARGET_APP', evidenceCompleteness: 0.2, corroborated: false });
  assert.notEqual(r.status, 'CONFIRMED');
});

check('reproduction pass that did NOT recur lowers the score', () => {
  const withRepro = scoreFinding({ confidence: 'SIGNAL', origin: 'TARGET_APP', evidenceCompleteness: 0.5, corroborated: false, reproduced: false });
  const noRepro = scoreFinding({ confidence: 'SIGNAL', origin: 'TARGET_APP', evidenceCompleteness: 0.5, corroborated: false });
  assert.ok(withRepro.score < noRepro.score);
});

// ── Pipeline: gating + correlation ──
check('pipeline rejects an artifact fault (no report)', () => {
  const p = new VerificationPipeline(() => 1000);
  const out = p.evaluate({ faultType: 'EXCEPTION', message: 'Target closed', confidence: 'INFERRED' });
  assert.equal(out.report, false);
  assert.equal(out.origin, 'PLAYWRIGHT');
});

check('pipeline reports a real 5xx and marks it corroborated on recurrence', () => {
  const p = new VerificationPipeline(() => 1000);
  const first = p.evaluate({
    faultType: 'NETWORK', message: 'HTTP 500 POST /api/orders', confidence: 'SIGNAL',
    url: 'https://app.test/api/orders', statusCode: 500,
    content: 'Internal Server Error', evidence: { hasMessage: true, hasStatusCode: true },
  });
  assert.equal(first.report, true);
  assert.equal(first.corroborated, false);
  const second = p.evaluate({
    faultType: 'NETWORK', message: 'HTTP 500 POST /api/orders', confidence: 'SIGNAL',
    url: 'https://app.test/api/orders', statusCode: 500,
    content: 'Internal Server Error', evidence: { hasMessage: true, hasStatusCode: true },
  });
  assert.equal(second.corroborated, true);
  assert.equal(second.status, 'CONFIRMED');
});

check('cross-channel: console error + same-URL 5xx within window → corroborated', () => {
  let t = 1000;
  const p = new VerificationPipeline(() => t);
  p.evaluate({ faultType: 'NETWORK', message: 'HTTP 500 GET /api/x', confidence: 'SIGNAL', url: 'https://app.test/api/x', statusCode: 500 });
  t = 1500;
  const out = p.evaluate({ faultType: 'CONSOLE', message: 'fetch failed for /api/x', confidence: 'SIGNAL', url: 'https://app.test/api/x' });
  assert.equal(out.corroborated, true);
});

console.log(`\n${passed} checks passed.`);

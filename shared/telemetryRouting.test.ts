// Self-executing checks for the network-vs-finding decision tree. Guards the
// contract both packages depend on: infrastructure and ordinary network events
// stay on the Network tab, and only actionable defects become findings. Run with
// `npx tsx "shared/telemetryRouting.test.ts"` or `npm test --workspace shared`.

import assert from 'node:assert/strict';
import {
  isPromotableReason,
  routeFindingPayload,
  routeNetworkEvent,
  siteRelationship,
  NON_TARGET_NETWORK_REASONS,
} from './types/telemetryRouting.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('\nTelemetry routing — Network tab vs Findings\n');

// ── Network tab only ──────────────────────────────────────────

check('DNS failure is environment, never a finding', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', url: 'https://app.io/api/x', resourceType: 'xhr', failureText: 'net::ERR_NAME_NOT_RESOLVED' });
  assert.equal(v.surface, 'NETWORK_ONLY');
  assert.equal(v.reasonCode, 'ENVIRONMENT');
});

check('offline and TLS failures route to the Network tab', () => {
  for (const text of ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_PROXY_CONNECTION_FAILED']) {
    const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', resourceType: 'xhr', failureText: text });
    assert.equal(v.promote, false, text);
    assert.equal(v.reasonCode, 'ENVIRONMENT', text);
  }
});

check('first-party connection refusal is infrastructure, not a finding', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', url: 'https://app.io/api/orders', resourceType: 'fetch', failureText: 'net::ERR_CONNECTION_REFUSED' });
  assert.equal(v.surface, 'NETWORK_ONLY');
});

check('Playwright driver timeout is a harness artifact', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', resourceType: 'xhr', failureText: 'Timeout exceeded while waiting for locator' });
  assert.equal(v.reasonCode, 'HARNESS_ARTIFACT');
  assert.equal(v.promote, false);
});

check('defensive 4xx stays on the Network tab', () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429]) {
    const v = routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: status, resourceType: 'xhr' });
    assert.equal(v.promote, false, `HTTP ${status}`);
    assert.equal(v.reasonCode, 'DEFENSIVE_CLIENT_ERROR', `HTTP ${status}`);
  }
});

check('404 on a static asset is dropped as noise', () => {
  const v = routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: 404, url: 'https://app.io/favicon.ico', resourceType: 'image' });
  assert.equal(v.reasonCode, 'ASSET_NOISE');
});

check('CORS block is a configuration issue, not a defect', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', resourceType: 'xhr', failureText: 'net::ERR_BLOCKED_BY_RESPONSE (blocked by CORS policy)' });
  assert.equal(v.reasonCode, 'CORS_BLOCKED');
  assert.equal(v.promote, false);
});

check('cancelled request is never a defect', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', resourceType: 'xhr', failureText: 'net::ERR_ABORTED' });
  assert.equal(v.reasonCode, 'CANCELLED');
});

check('a clean 2xx is not actionable', () => {
  assert.equal(routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: 200, resourceType: 'xhr' }).promote, false);
});

check('a redirect loop is a shown Network row, not a raw transport failure', () => {
  for (const text of ['net::ERR_TOO_MANY_REDIRECTS', 'Error: too many redirects', 'redirect loop detected']) {
    const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', url: 'https://app.io/r2', resourceType: 'document', failureText: text });
    assert.equal(v.reasonCode, 'REDIRECT_ERROR', text);
    assert.equal(v.surface, 'NETWORK_ONLY', text);
    assert.equal(NON_TARGET_NETWORK_REASONS.has(v.reasonCode), false, `${text} stays shown`);
  }
});

check('cancelled/asset/harness are the non-target reasons hidden from the Network tab', () => {
  assert.equal(NON_TARGET_NETWORK_REASONS.has('CANCELLED'), true);
  assert.equal(NON_TARGET_NETWORK_REASONS.has('ASSET_NOISE'), true);
  assert.equal(NON_TARGET_NETWORK_REASONS.has('HARNESS_ARTIFACT'), true);
  assert.equal(NON_TARGET_NETWORK_REASONS.has('SERVER_ERROR'), false);
  assert.equal(NON_TARGET_NETWORK_REASONS.has('REDIRECT_ERROR'), false);
  assert.equal(NON_TARGET_NETWORK_REASONS.has('DEFENSIVE_CLIENT_ERROR'), false);
});

check('site relationship matches on the registrable domain (api subdomain is first-party)', () => {
  assert.equal(siteRelationship('https://api.app.io/orders', 'https://app.io'), 'FIRST_PARTY');
  assert.equal(siteRelationship('https://cdn.other.com/x.js', 'https://app.io'), 'THIRD_PARTY');
  assert.equal(siteRelationship('https://app.io/x', ''), 'UNKNOWN');
  assert.equal(siteRelationship('not a url', 'https://app.io'), 'UNKNOWN');
});

// ── Promoted to Findings ──────────────────────────────────────

check('HTTP 5xx is a finding', () => {
  const v = routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: 500, url: 'https://app.io/api/orders', resourceType: 'xhr' });
  assert.equal(v.surface, 'FINDING');
  assert.equal(v.reasonCode, 'SERVER_ERROR');
});

check('HTTP 200 carrying an error payload is a finding', () => {
  const v = routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: 200, resourceType: 'xhr', softFailBody: true });
  assert.equal(v.reasonCode, 'SOFT_FAIL_BODY');
  assert.equal(v.promote, true);
});

check('chaos-injected failure outranks the cancellation filter', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', resourceType: 'xhr', failureText: 'net::ERR_ABORTED', chaosInjected: true });
  assert.equal(v.reasonCode, 'CHAOS_INJECTED');
  assert.equal(v.promote, true);
});

check('chaos injection does NOT promote a healthy response', () => {
  const v = routeNetworkEvent({ kind: 'HTTP_RESPONSE', statusCode: 200, resourceType: 'xhr', chaosInjected: true });
  assert.equal(v.promote, false);
});

check('a failure that broke the UI outranks the environment filter', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', resourceType: 'xhr', failureText: 'net::ERR_CONNECTION_RESET', causedRuntimeFault: true });
  assert.equal(v.reasonCode, 'BROKE_UI');
  assert.equal(v.tier, 'CRITICAL');
});

check('asset noise outranks everything — never a finding', () => {
  const v = routeNetworkEvent({ kind: 'TRANSPORT_FAILURE', url: 'https://cdn.io/app.css', resourceType: 'stylesheet', failureText: 'net::ERR_CONNECTION_RESET', causedRuntimeFault: true });
  assert.equal(v.reasonCode, 'ASSET_NOISE');
});

// ── Dashboard re-application ──────────────────────────────────

check('runtime faults are always findings on the client side', () => {
  assert.equal(routeFindingPayload({ type: 'EXCEPTION', message: 'TypeError: x is not a function' }).promote, true);
  assert.equal(routeFindingPayload({ type: 'DUPLICATE_ACTION', message: 'Duplicate POST /orders' }).promote, true);
});

check('a legacy DNS network finding is re-routed off the Errors tab', () => {
  const v = routeFindingPayload({ type: 'NETWORK', message: 'Network Request Failed: net::ERR_NAME_NOT_RESOLVED', url: 'https://app.io/api/x' });
  assert.equal(v.promote, false);
});

check('a legacy 5xx network finding stays a finding', () => {
  assert.equal(routeFindingPayload({ type: 'NETWORK', statusCode: 503, message: 'HTTP 503 GET /api/orders' }).promote, true);
});

check('recorded reason codes gate promotion', () => {
  assert.equal(isPromotableReason('SERVER_ERROR'), true);
  assert.equal(isPromotableReason('BROKE_UI'), true);
  assert.equal(isPromotableReason('CHAOS_INJECTED'), true);
  assert.equal(isPromotableReason('ENVIRONMENT'), false);
  assert.equal(isPromotableReason(undefined), false);
});

check('determinism — identical input yields an identical verdict', () => {
  const input = { kind: 'HTTP_RESPONSE' as const, statusCode: 500, url: 'https://app.io/api/x', resourceType: 'xhr' };
  assert.deepEqual(routeNetworkEvent(input), routeNetworkEvent(input));
});

console.log(`\n${passed} routing checks passed.`);

// Self-executing checks for the network body-signature predicates — focused on
// isProxyGatewayArtifact, which keeps a tunnel/proxy EDGE 5xx (Cloudflare / cloudflared)
// out of the findings so a run exploring through a tunnel never reports an origin
// connection-drop as a phantom "Server API Failure". No runner is configured in this
// package. Run: `npx tsx src/domain/services/verification/softFailBody.test.ts`.

import assert from 'node:assert/strict';
import { isProxyGatewayArtifact, detectSoftFailBody } from './softFailBody.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('softFailBody — proxy/tunnel gateway-artifact detection');

const CF_BAD_GATEWAY = '<!DOCTYPE html><html><head><title>app.io | 502: Bad gateway</title></head>' +
  '<body>Error 502 Ray ID: 8b2f... Bad gateway. The web server reported a bad gateway error. ' +
  'Cloudflare</body></html>';
const CLOUDFLARED_TUNNEL = '<html><body>Error 1033: Argo Tunnel error. This tunnel is trying to connect ' +
  'to the Cloudflare edge.</body></html>';

check('a Cloudflare 502 Bad Gateway edge page is a proxy artifact', () => {
  assert.equal(isProxyGatewayArtifact(502, CF_BAD_GATEWAY), true);
});

check('a cloudflared quick-tunnel error page is a proxy artifact', () => {
  assert.equal(isProxyGatewayArtifact(502, CLOUDFLARED_TUNNEL), true);
});

check('a 504 gateway time-out edge page is a proxy artifact', () => {
  assert.equal(isProxyGatewayArtifact(504, 'Error 504: Gateway time-out — cloudflare'), true);
});

check('Cloudflare 520–527 origin errors are artifacts on status alone (even empty body)', () => {
  for (const status of [520, 521, 522, 523, 524, 525, 526, 527]) {
    assert.equal(isProxyGatewayArtifact(status, ''), true, `status ${status}`);
  }
});

check('a genuine origin 500 with the app’s own JSON body is NOT suppressed', () => {
  assert.equal(isProxyGatewayArtifact(500, '{"error":"order processing failed","code":"E_ORDER"}'), false);
});

check('a genuine origin 502 with an app body (no edge signature) is NOT suppressed', () => {
  // Some backends themselves return 502; without an edge error-page signature it stays a finding.
  assert.equal(isProxyGatewayArtifact(502, '{"message":"upstream service failed"}'), false);
});

check('a gateway status with an empty/unreadable body is NOT suppressed (keeps the finding)', () => {
  assert.equal(isProxyGatewayArtifact(502, ''), false);
  assert.equal(isProxyGatewayArtifact(503, undefined), false);
});

check('non-gateway statuses are never artifacts', () => {
  assert.equal(isProxyGatewayArtifact(200, 'cloudflare'), false);
  assert.equal(isProxyGatewayArtifact(404, 'bad gateway'), false);
  assert.equal(isProxyGatewayArtifact(500, 'cloudflare bad gateway'), false);
  assert.equal(isProxyGatewayArtifact(undefined, CF_BAD_GATEWAY), false);
});

check('a trycloudflare host mention in a gateway body is an artifact', () => {
  assert.equal(isProxyGatewayArtifact(503, 'origin is unreachable via roy-x.trycloudflare.com'), true);
});

// Guard: the sibling soft-fail detector is unaffected by the added export.
check('detectSoftFailBody still flags a masked 2xx error envelope', () => {
  assert.equal(detectSoftFailBody('{"success":false,"error":"validation failed"}').softFail, true);
  assert.equal(detectSoftFailBody('{"error":null,"active":true}').softFail, false);
});

console.log(`\n${passed} assertions passed.`);

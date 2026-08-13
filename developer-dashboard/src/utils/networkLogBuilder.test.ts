// Narrow Network-tab filter: genuine target failures stay, engine/browser noise drops.
// Run via `npm test`. Exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { isShownNetworkFailure, buildSavedNetworkRows } from './networkLogBuilder.js';
import type { TelemetryEvent } from '../types';

const meta = (m: Record<string, unknown>) => m as TelemetryEvent['meta'];
const netEvent = (m: Record<string, unknown>): TelemetryEvent =>
  ({ timestamp: '2026-08-13T00:00:00.000Z', type: 'NETWORK', meta: meta({ rawNetwork: true, ...m }) });

// Genuine failures a developer investigates — kept.
assert.equal(isShownNetworkFailure(meta({ rawNetwork: true, statusCode: 500, url: 'https://app.test/api' })), true, '5xx server error is shown');
assert.equal(isShownNetworkFailure(meta({ rawNetwork: true, statusCode: 404, url: 'https://app.test/api' })), true, '4xx client error is shown');

// Engine/browser noise — hidden.
assert.equal(isShownNetworkFailure(meta({ rawNetwork: true, url: 'https://app.test/reports/old', errorText: 'net::ERR_ABORTED' })), false, 'a cancelled request is hidden');
assert.equal(isShownNetworkFailure(meta({ rawNetwork: true, url: 'https://app.test/logo.png', resourceType: 'image', statusCode: 404 })), false, 'a failed static asset is hidden');

// Not a raw target request (BugSafari diagnostic on the NETWORK channel) — never shown.
assert.equal(isShownNetworkFailure(meta({ rawNetwork: false, statusCode: 500 })), false, 'a non-raw diagnostic is not a network failure');

// The list builder applies the same rule: a cancelled row never reaches the saved log / badge.
const rows = buildSavedNetworkRows([
  netEvent({ method: 'GET', url: 'https://app.test/reports/old', errorText: 'net::ERR_ABORTED' }),
  netEvent({ method: 'GET', url: 'https://app.test/api', statusCode: 500 }),
]);
assert.equal(rows.length, 1, 'only the genuine 500 is kept');
assert.equal(rows[0].statusCode, 500, 'the kept row is the server error');

console.log('networkLogBuilder.test.ts: all assertions passed');

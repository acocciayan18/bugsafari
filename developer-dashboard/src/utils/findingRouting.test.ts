// Self-executing checks for the finding-routing guard. No test framework (per the
// "no external libraries" rule) — run via `npm test --workspace bugsafaridashboard`.
// Locks the contract that engine/runtime failures never reach the Errors tab.

import assert from 'node:assert/strict';
import { isReportableFinding } from './findingRouting.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('engine navigation timeout is NOT a finding', () => {
  assert.equal(isReportableFinding({ reason: 'page.goto: Timeout 20000ms exceeded.' }), false);
});

check('fatal engine error wrapping a goto timeout is NOT a finding', () => {
  assert.equal(isReportableFinding({ reason: 'Fatal engine error: page.goto: Timeout 20000ms exceeded.' }), false);
});

check('browser launch failure is NOT a finding', () => {
  assert.equal(isReportableFinding({ reason: "browserType.launch: Executable doesn't exist" }), false);
});

check('closed-context error is NOT a finding', () => {
  assert.equal(isReportableFinding({ reason: 'Target page, context or browser has been closed' }), false);
});

check('PLAYWRIGHT-origin attribution overrides any prose', () => {
  assert.equal(isReportableFinding({ reason: 'anything at all', attribution: { origin: 'PLAYWRIGHT' } }), false);
});

check('NETWORK_ENV-origin attribution is suppressed', () => {
  assert.equal(isReportableFinding({ reason: 'connection lost', attribution: { origin: 'NETWORK_ENV' } }), false);
});

check('DNS/infra transport failure is NOT a finding', () => {
  assert.equal(isReportableFinding({ reason: 'net::ERR_NAME_NOT_RESOLVED' }), false);
});

check('genuine target runtime exception IS a finding', () => {
  assert.equal(isReportableFinding({ reason: "TypeError: Cannot read properties of null (reading 'id')" }), true);
});

check('TARGET_APP-origin fault IS a finding', () => {
  assert.equal(isReportableFinding({ reason: 'unhandled state error', attribution: { origin: 'TARGET_APP' } }), true);
});

check('HTTP 5xx server error IS a finding', () => {
  assert.equal(isReportableFinding({ reason: 'HTTP 500 GET /api/report', statusCode: 500 }), true);
});

check('defensive 4xx is NOT a finding', () => {
  assert.equal(isReportableFinding({ reason: 'HTTP 404 GET /missing', statusCode: 404 }), false);
});

console.log(`\n${passed} finding-routing checks passed.`);

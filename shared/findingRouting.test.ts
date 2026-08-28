// Self-executing checks for the shared reportability predicate. The dashboard live
// filter and the backend persistence collapse both call THIS, so History can never hold
// a finding the live tab suppressed (or vice versa). Run with `npx tsx "shared/findingRouting.test.ts"`.

import assert from 'node:assert/strict';
import { isReportableFinding } from './findingRouting.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('a target-app runtime fault is reportable', () => {
  assert.equal(isReportableFinding({ reason: 'TypeError: x is undefined', attribution: { origin: 'TARGET_APP' } }), true);
});

check('a non-application origin (Playwright artifact) is never reported', () => {
  assert.equal(isReportableFinding({ reason: 'boom', attribution: { origin: 'PLAYWRIGHT' } }), false);
});

check('an engine navigation timeout is suppressed by the fallback', () => {
  assert.equal(isReportableFinding({ reason: 'page.goto: Timeout 20000ms exceeded.' }), false);
});

console.log(`\nfindingRouting.test.ts: ${passed} checks passed`);

// Self-executing checks for the session-loss defect gate. Guards that a self-healed
// bounce (auto re-auth succeeded) is NOT recorded as a finding — the false positive seen
// in findings.txt (three "re-authentication succeeded" cards). Run via `npm test` or
// `npx tsx .../SessionPreservationGuard.sessionLoss.test.ts`.

import assert from 'node:assert/strict';
import { sessionLossIsDefect } from './SessionPreservationGuard.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('SessionPreservationGuard — session-loss defect gate');

check('a recovered bounce is NOT a defect (no finding)', () => {
  assert.equal(sessionLossIsDefect('recovered'), false);
});

check('a failed restore IS a defect', () => {
  assert.equal(sessionLossIsDefect('restore-failed'), true);
});

check('no restore available IS a defect', () => {
  assert.equal(sessionLossIsDefect('no-restore'), true);
});

console.log(`\nSessionPreservationGuard.sessionLoss: ${passed} checks passed.`);

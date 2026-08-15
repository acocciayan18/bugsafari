// Self-executing checks for the saved-session importance gate. Run with
// `npx tsx "shared/session.test.ts"` or `npm test -w shared`.
//
// isImportantSession decides whether permanent deletion demands typed confirmation,
// so its threshold is a destructive-action guard and is pinned here against drift.

import assert from 'node:assert/strict';
import { isImportantSession, IMPORTANT_FINDING_THRESHOLD } from './types/session.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('session — importance gate for permanent deletion');

check('the threshold is the CRITICAL-badge count (3)', () => {
  assert.equal(IMPORTANT_FINDING_THRESHOLD, 3);
});

check('below the threshold is not important', () => {
  assert.equal(isImportantSession(0), false);
  assert.equal(isImportantSession(2), false);
});

check('at or above the threshold is important', () => {
  assert.equal(isImportantSession(3), true);
  assert.equal(isImportantSession(50), true);
});

console.log(`\nsession: ${passed} checks passed.`);

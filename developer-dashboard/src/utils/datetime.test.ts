// Self-executing checks for the log-row timestamp formatter. No test framework (per
// the "no external libraries" rule) — run via `npm test --workspace bugsafaridashboard`.
// TZ is pinned so the assertions are not machine-dependent.

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { formatLogTimestamp } from './datetime.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('formats an ISO timestamp as "Mon D, h:mm:ss AM/PM"', () => {
  assert.equal(formatLogTimestamp('2026-07-30T10:45:23.456Z'), 'Jul 30, 10:45:23 AM');
});

check('uses a 12-hour clock with PM past noon', () => {
  assert.equal(formatLogTimestamp('2026-07-30T15:04:05.000Z'), 'Jul 30, 3:04:05 PM');
});

check('renders midnight as 12 AM rather than 0', () => {
  assert.equal(formatLogTimestamp('2026-01-01T00:00:09.000Z'), 'Jan 1, 12:00:09 AM');
});

check('returns a placeholder for an absent value', () => {
  assert.equal(formatLogTimestamp(undefined), '—');
  assert.equal(formatLogTimestamp(''), '—');
});

check('passes an unparseable value through untouched', () => {
  assert.equal(formatLogTimestamp('not-a-date'), 'not-a-date');
});

console.log(`\n${passed} datetime check(s) passed.`);

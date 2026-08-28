// Self-executing checks for the History severity badge mapping. No test framework
// (per the "no external libraries" rule) — run via `npm test --workspace bugsafaridashboard`.
// Guards the reported bug: the badge showed a count-derived tier ("3 Critical") instead
// of the worst real finding severity.

import assert from 'node:assert/strict';
import type { SessionHistoryEntry, SeverityCounts } from '../../types';
import { transformSessionsToEvaluations } from './types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Minimal history row; only severity-relevant fields vary per case.
function entry(findingCount: number, severityCounts?: SeverityCounts): SessionHistoryEntry {
  return {
    id: 'RUN-TEST01',
    runId: 'RUN-TEST01',
    targetUrl: 'https://example.com',
    status: 'Completed',
    startedAt: '2026-08-28T00:00:00.000Z',
    savedManually: true,
    findingCount,
    severityCounts,
    actionTraceCount: 10,
    brainSnapshots: 0,
  };
}

console.log('history severity summary — badge reflects the worst real finding');

check('badge shows the worst tier + its count, not the total finding count', () => {
  // 2 CRITICAL + 1 MEDIUM: the old code showed "3 CRITICAL"; it must now be "2 CRITICAL".
  const [row] = transformSessionsToEvaluations([entry(3, { CRITICAL: 2, MEDIUM: 1 })]);
  assert.equal(row.severity, 'CRITICAL');
  assert.equal(row.severityCount, 2);
  assert.equal(row.findingCount, 3);
});

check('findings with no critical resolve to their real worst tier (MEDIUM)', () => {
  const [row] = transformSessionsToEvaluations([entry(4, { MEDIUM: 3, LOW: 1 })]);
  assert.equal(row.severity, 'MEDIUM');
  assert.equal(row.severityCount, 3);
});

check('a clean run (no findings) is CLEAR with a zero count', () => {
  const [row] = transformSessionsToEvaluations([entry(0, {})]);
  assert.equal(row.severity, 'CLEAR');
  assert.equal(row.severityCount, 0);
});

check('legacy rows without severityCounts fall back to the count tier', () => {
  const [critical] = transformSessionsToEvaluations([entry(3, undefined)]);
  assert.equal(critical.severity, 'CRITICAL');
  assert.equal(critical.severityCount, 3);

  const [high] = transformSessionsToEvaluations([entry(2, undefined)]);
  assert.equal(high.severity, 'HIGH');
  assert.equal(high.severityCount, 2);

  const [clear] = transformSessionsToEvaluations([entry(0, undefined)]);
  assert.equal(clear.severity, 'CLEAR');
  assert.equal(clear.severityCount, 0);
});

console.log(`\nAll ${passed} assertions passed.`);

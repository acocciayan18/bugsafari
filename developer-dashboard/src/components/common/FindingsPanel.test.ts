// Findings display order: queue inside severity groups (oldest→newest, new card at
// the bottom), strict newest-first when the operator picks the Newest sort.
// Run via `npm test`. Exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { sortFindingEntries } from './FindingsPanel.js';
import type { FindingEntry } from './FindingsPanel.js';
import type { FindingView } from '../../utils/findingView';

const entry = (key: string, severity: string, timestamp: string): FindingEntry => ({
  key,
  view: { key, category: 'OTHER', severity, timestamp } as FindingView,
  render: () => null,
});

const keys = (rows: FindingEntry[]) => rows.map((r) => r.key);

// Severity sort: same severity ⇒ oldest→newest (queue), so a new finding lands last.
const sameSev = [
  entry('mid', 'HIGH', '2026-08-21T10:01:00.000Z'),
  entry('old', 'HIGH', '2026-08-21T10:00:00.000Z'),
  entry('new', 'HIGH', '2026-08-21T10:02:00.000Z'),
];
assert.deepEqual(keys(sortFindingEntries(sameSev, 'severity')), ['old', 'mid', 'new'], 'queue order inside a severity group');

// Severity sort: higher severity groups first regardless of arrival time.
const crossSev = [
  entry('lowFirst', 'LOW', '2026-08-21T10:00:00.000Z'),
  entry('critLater', 'CRITICAL', '2026-08-21T10:05:00.000Z'),
];
assert.deepEqual(keys(sortFindingEntries(crossSev, 'severity')), ['critLater', 'lowFirst'], 'Critical group ranks above Low');

// Input array is not mutated.
const original = keys(crossSev);
sortFindingEntries(crossSev, 'severity');
assert.deepEqual(keys(crossSev), original, 'sort returns a copy, leaves input untouched');

// Newest sort: strict newest-first across all severities.
assert.deepEqual(keys(sortFindingEntries(sameSev, 'newest')), ['new', 'mid', 'old'], 'Newest sort is newest-first');

console.log('FindingsPanel.test.ts: all assertions passed');

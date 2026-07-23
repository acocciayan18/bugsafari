// Self-executing checks for the client-side fault reconciliation that keeps the
// live Errors Tab, the engine's confirmed-bug count, and saved history 1:1 across
// normal operation, browser refreshes, and reconnect replays. No test framework
// (per the "no external libraries" rule) — run via `npm test --workspace
// bugsafaridashboard`. Exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import type { IncidentReport, ForensicCrashReport } from '../types';
import {
  dedupeReportsAgainstIncidents,
  collapseFaultIntoBuffer,
  groupBySignature,
  liveFaultSignature,
} from './errorDeduplication.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const incident = (over: Partial<IncidentReport> = {}): IncidentReport => ({
  timestamp: '2026-07-23T00:00:00.000Z',
  reason: 'TypeError: x is undefined',
  url: 'https://app/page',
  steps: [],
  ...over,
});
const report = (over: Partial<ForensicCrashReport> = {}): ForensicCrashReport => ({
  timestamp: '2026-07-23T00:00:01.000Z',
  reason: 'TypeError: x is undefined',
  url: 'https://app/page',
  breadcrumbs: [],
  ...over,
});

// Normal operation: one JS fault streamed as BOTH an incident and a crash report
// must collapse to a single slot so the live count matches the engine's single
// registration (and, in turn, what is saved to history).
check('incident+report pair for one fault dedupes to a single card', () => {
  const kept = dedupeReportsAgainstIncidents([incident()], [report()]);
  assert.equal(kept.length, 0, 'the report is already represented by the incident');
});

check('a crash-only fault (no matching incident) is preserved', () => {
  const kept = dedupeReportsAgainstIncidents([incident({ reason: 'A' })], [report({ reason: 'B' })]);
  assert.equal(kept.length, 1);
});

// Live accumulation: repeats of one fault bump the running count, never a new slot.
check('live repeats increment the occurrence count in place', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident());
  buf = collapseFaultIntoBuffer(buf, incident());
  buf = collapseFaultIntoBuffer(buf, incident());
  assert.equal(buf.length, 1);
  assert.equal(buf[0].occurrences, 3);
});

// Browser refresh / reconnect: the backend replays a hydrated row carrying its TRUE
// accumulated total. It must seed that total, not be discounted to the replay count
// — otherwise the restored ×N would disagree with the live ×N (FE11).
check('hydrated row seeds its true total on restore (no under-count)', () => {
  const restored = collapseFaultIntoBuffer<IncidentReport>([], incident({ occurrences: 15 }));
  assert.equal(restored[0].occurrences, 15, 'restore preserves the pre-refresh count');
});

check('a live repeat after restore continues from the restored total', () => {
  let buf = collapseFaultIntoBuffer<IncidentReport>([], incident({ occurrences: 15 }));
  buf = collapseFaultIntoBuffer(buf, incident()); // one fresh live occurrence
  assert.equal(buf[0].occurrences, 16, 'restored 15 + 1 live = 16, never reset to 1 or 2');
});

// Restore is idempotent: hydrateFromSnapshot reduces the snapshot's distinct rows
// through collapseFaultIntoBuffer FROM AN EMPTY buffer (runStore.hydrateFromSnapshot),
// so replaying the same snapshot on a second reconnect yields identical counts — a
// refresh never inflates the ×N.
check('re-hydrating the same snapshot is idempotent (distinct rows preserved)', () => {
  const snapshot: IncidentReport[] = [
    incident({ reason: 'A', url: 'https://app/a', occurrences: 15 }),
    incident({ reason: 'B', url: 'https://app/b', occurrences: 4 }),
  ];
  const hydrate = (rows: IncidentReport[]): IncidentReport[] =>
    rows.reduce<IncidentReport[]>((buf, r) => collapseFaultIntoBuffer(buf, r), []);
  const counts = (rows: IncidentReport[]): Record<string, number | undefined> =>
    Object.fromEntries(rows.map((r) => [r.reason, r.occurrences]));
  const first = hydrate(snapshot);
  const second = hydrate(snapshot); // second reconnect replays the same snapshot
  assert.equal(first.length, 2, 'distinct faults each keep their own slot');
  assert.deepEqual(counts(first), { A: 15, B: 4 }, 'each distinct fault keeps its true accumulated total');
  assert.deepEqual(counts(first), counts(second), 'a repeated restore produces identical counts (idempotent)');
});

// A high-frequency fault must not flood the cap and evict a rarer distinct fault.
check('cap keeps distinct faults; hot fault moves to front without evicting', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident({ reason: 'rare', url: 'https://app/rare' }), 2);
  buf = collapseFaultIntoBuffer(buf, incident({ reason: 'hot', url: 'https://app/hot' }), 2);
  buf = collapseFaultIntoBuffer(buf, incident({ reason: 'hot', url: 'https://app/hot' }), 2);
  assert.equal(buf.length, 2);
  assert.ok(buf.some((f) => f.reason === 'rare'), 'the rarer distinct fault survives');
  assert.equal(buf[0].reason, 'hot', 'the repeated fault is refreshed to the front');
});

// Grouping preserves accumulated counts so a collapsed buffer renders the true total.
check('groupBySignature sums accumulated occurrences', () => {
  const rows = [incident({ occurrences: 4 }), incident({ occurrences: 3 })];
  const groups = groupBySignature(rows, liveFaultSignature, (r) => r.occurrences ?? 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 7);
});

console.log(`\n${passed} errorDeduplication assertion group(s) passed.`);

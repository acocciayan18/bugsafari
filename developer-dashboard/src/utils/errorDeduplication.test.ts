// Self-executing checks for the client-side fault reconciliation that keeps the
// live Errors Tab, the engine's confirmed-bug count, and saved history 1:1 across
// normal operation, browser refreshes, and reconnect replays. No test framework
// (per the "no external libraries" rule) — run via `npm test --workspace
// bugsafaridashboard`. Exits non-zero on the first failed node:assert.
//
// Occurrence contract: the ×N count is the SUM of authoritative per-bugId manifestation
// counts, DISPLAYED — never incremented on arrival. Duplicate telemetry (the forensic→
// incident twin), reconnect replays, and no-identity repeats can never inflate it; only a
// finding-occurrence patch or a genuinely distinct bugId changes it.

import assert from 'node:assert/strict';
import type { IncidentReport, ForensicCrashReport } from '../types';
import {
  dedupeReportsAgainstIncidents,
  collapseFaultIntoBuffer,
  applyOccurrencePatchToBuffer,
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

// ROOT CAUSE regression: the forensic→incident twin. The engine streams one JS fault as a
// real incident AND a synthesized incident twin — SAME bugId, occurrences 1. The twin must
// collapse onto its origin and the count stays ×1, never ×2.
check('the forensic→incident twin (same bugId) yields ×1, not ×2', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'runtime-x', occurrences: 1 }));
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'runtime-x', occurrences: 1 }));
  assert.equal(buf.length, 1);
  assert.equal(buf[0].occurrences, 1, 'duplicate telemetry of ONE occurrence is not a second occurrence');
});

// Reconnect / refresh replays the same events — the count must not move (idempotent).
check('replaying the same bugId events is idempotent (no inflation)', () => {
  const deliver = (buf: IncidentReport[]): IncidentReport[] =>
    [incident({ bugId: 'runtime-x', occurrences: 1 }), incident({ bugId: 'runtime-x', occurrences: 1 })]
      .reduce((b, e) => collapseFaultIntoBuffer(b, e), buf);
  const first = deliver([]);
  const second = deliver(first); // reconnect replays the same two events
  assert.equal(first[0].occurrences, 1);
  assert.equal(second[0].occurrences, 1, 'a reconnect replay never inflates the ×N');
});

// No arrival-time +1: N deliveries of one bugId, each carrying occurrences 1, stay ×1.
check('N deliveries of one bugId with occurrences:1 stay ×1', () => {
  let buf: IncidentReport[] = [];
  for (let i = 0; i < 5; i += 1) buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'runtime-x', occurrences: 1 }));
  assert.equal(buf.length, 1);
  assert.equal(buf[0].occurrences, 1);
});

// Two genuinely DISTINCT findings that share a display signature contribute their own
// authoritative counts — the card shows the sum.
check('distinct bugIds sharing a display signature sum their authoritative counts', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'a', occurrences: 3 }));
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'b', occurrences: 4 }));
  assert.equal(buf.length, 1, 'same display signature ⇒ one card');
  assert.equal(buf[0].occurrences, 7, '3 + 4 authoritative manifestations');
});

// The finding-occurrence patch advances a card's ×N by bugId — the ONLY way a live repeat
// raises the count. Monotonic and idempotent.
check('applyOccurrencePatchToBuffer raises the ×N by bugId, monotonically', () => {
  let buf = collapseFaultIntoBuffer<IncidentReport>([], incident({ bugId: 'runtime-x', occurrences: 1 }));
  buf = applyOccurrencePatchToBuffer(buf, 'runtime-x', 5); // engine verified 5 real manifestations
  assert.equal(buf.length, 1, 'a patch never spawns a second card');
  assert.equal(buf[0].occurrences, 5);
  buf = applyOccurrencePatchToBuffer(buf, 'runtime-x', 3); // stale/lower total ignored
  assert.equal(buf[0].occurrences, 5, 'a lower total never lowers the count');
});

check('a patch for an aggregated card updates only its bugs bucket', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'a', occurrences: 1 }));
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'b', occurrences: 1 }));
  buf = applyOccurrencePatchToBuffer(buf, 'a', 4); // a recurred 4×; b unchanged
  assert.equal(buf[0].occurrences, 5, 'a:4 + b:1');
});

check('a patch for an unknown bugId is a no-op', () => {
  const buf = collapseFaultIntoBuffer<IncidentReport>([], incident({ bugId: 'runtime-x', occurrences: 1 }));
  const after = applyOccurrencePatchToBuffer(buf, 'never-seen', 9);
  assert.equal(after, buf, 'same reference — nothing changed');
});

// Browser refresh / reconnect: the backend replays a hydrated row carrying its TRUE
// accumulated total. It must seed that total, not be discounted.
check('hydrated row seeds its true total on restore (no under-count)', () => {
  const restored = collapseFaultIntoBuffer<IncidentReport>([], incident({ bugId: 'runtime-x', occurrences: 15 }));
  assert.equal(restored[0].occurrences, 15, 'restore preserves the pre-refresh count');
});

// Restore is idempotent: hydrateFromSnapshot reduces the snapshot's distinct rows through
// collapseFaultIntoBuffer FROM AN EMPTY buffer, so replaying the same snapshot yields
// identical counts — a refresh never inflates the ×N.
check('re-hydrating the same snapshot is idempotent (distinct rows preserved)', () => {
  const snapshot: IncidentReport[] = [
    incident({ bugId: 'a', reason: 'A', url: 'https://app/a', occurrences: 15 }),
    incident({ bugId: 'b', reason: 'B', url: 'https://app/b', occurrences: 4 }),
  ];
  const hydrate = (rows: IncidentReport[]): IncidentReport[] =>
    rows.reduce<IncidentReport[]>((buf, r) => collapseFaultIntoBuffer(buf, r), []);
  const counts = (rows: IncidentReport[]): Record<string, number | undefined> =>
    Object.fromEntries(rows.map((r) => [r.reason, r.occurrences]));
  const first = hydrate(snapshot);
  const second = hydrate(snapshot);
  assert.equal(first.length, 2, 'distinct faults each keep their own slot');
  assert.deepEqual(counts(first), { A: 15, B: 4 }, 'each distinct fault keeps its true accumulated total');
  assert.deepEqual(counts(first), counts(second), 'a repeated restore produces identical counts (idempotent)');
});

// A legacy emission with no bugId cannot prove distinct manifestations — it seeds 1 and a
// repeat delivery never accumulates (conservative: never a false multiplier).
check('legacy no-bugId repeats never accumulate', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident());
  buf = collapseFaultIntoBuffer(buf, incident());
  buf = collapseFaultIntoBuffer(buf, incident());
  assert.equal(buf.length, 1);
  assert.equal(buf[0].occurrences, 1, 'no identity ⇒ cannot count as another occurrence');
});

// A high-frequency fault must not flood the cap and evict a rarer distinct fault:
// a repeat collapses in place (no new slot), so no eviction, and first-seen order holds.
check('cap keeps distinct faults; a repeat collapses in place without reordering', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'rare', reason: 'rare', url: 'https://app/rare' }), 2);
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'hot', reason: 'hot', url: 'https://app/hot' }), 2);
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: 'hot', reason: 'hot', url: 'https://app/hot' }), 2);
  assert.equal(buf.length, 2);
  assert.equal(buf[0].reason, 'rare', 'first-seen order holds — the repeat does not jump position');
  assert.equal(buf[1].reason, 'hot', 'the repeated fault stays in place');
});

// New distinct faults append to the bottom so the latest finding is always last.
check('distinct faults accumulate oldest → newest (latest last)', () => {
  let buf: IncidentReport[] = [];
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: '1', reason: 'first', url: 'https://app/1' }));
  buf = collapseFaultIntoBuffer(buf, incident({ bugId: '2', reason: 'second', url: 'https://app/2' }));
  assert.deepEqual(buf.map((f) => f.reason), ['first', 'second']);
});

// Grouping preserves accumulated counts so a collapsed buffer renders the true total.
check('groupBySignature sums accumulated occurrences', () => {
  const rows = [incident({ occurrences: 4 }), incident({ occurrences: 3 })];
  const groups = groupBySignature(rows, liveFaultSignature, (r) => r.occurrences ?? 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 7);
});

// PARITY invariant: the total ×N the operator watches live equals the sum of the distinct
// findings' authoritative counts — never more (the twin/replay bug) and never less. The
// backend save path sums the SAME authoritative counts, so Live and History agree.
check('total displayed ×N conserves the distinct authoritative counts (Live == History)', () => {
  let incidents: IncidentReport[] = [];
  // One JS fault: real incident + forensic twin (same bugId, 3 verified manifestations).
  incidents = collapseFaultIntoBuffer(incidents, incident({ bugId: 'runtime-x', occurrences: 3 }));
  incidents = collapseFaultIntoBuffer(incidents, incident({ bugId: 'runtime-x', occurrences: 3 })); // twin
  // A distinct 5xx finding sharing the display signature, 2 manifestations.
  incidents = collapseFaultIntoBuffer(incidents, incident({ bugId: 'http-500', occurrences: 2 }));
  // A later verified recurrence of the JS fault → authoritative patch to 5.
  incidents = applyOccurrencePatchToBuffer(incidents, 'runtime-x', 5);

  const totalDisplayed = incidents.reduce((sum, i) => sum + (i.occurrences ?? 0), 0);
  // Distinct authoritative counts: runtime-x = 5 (patched), http-500 = 2.
  assert.equal(totalDisplayed, 7, 'twin never adds; the patch sets the authoritative total; distinct bugs sum');
});

// The live buffer must pick the SAME representative the saved collapse does — the
// content-richest sighting, deterministically — so the live card's reproduction steps
// match the saved report regardless of which sighting streamed first. Occurrence
// accounting is keyed by bugId, independent of which object represents the family.
check('collapseFaultIntoBuffer keeps the content-richest representative, order-independent', () => {
  const thin = incident({ bugId: 'x', reproductionPlaybook: ['Step 1'], occurrences: 1 });
  const rich = incident({ bugId: 'x', reproductionPlaybook: ['Step 1', 'Step 2', 'Step 3'], occurrences: 1 });
  const forward = collapseFaultIntoBuffer(collapseFaultIntoBuffer<IncidentReport>([], thin), rich);
  const reverse = collapseFaultIntoBuffer(collapseFaultIntoBuffer<IncidentReport>([], rich), thin);
  assert.deepEqual(forward[0].reproductionPlaybook, ['Step 1', 'Step 2', 'Step 3']);
  assert.deepEqual(reverse[0].reproductionPlaybook, ['Step 1', 'Step 2', 'Step 3'], 'the pick never depends on arrival order');
  assert.equal(forward[0].occurrences, 1, 'same bugId ⇒ monotonic max, still ×1');
  assert.equal(reverse[0].occurrences, 1);
});

console.log(`\n${passed} errorDeduplication assertion group(s) passed.`);

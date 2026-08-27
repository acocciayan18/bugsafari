// ─────────────────────────────────────────────────────────────
// Live error de-duplication
// ─────────────────────────────────────────────────────────────
// A single JS runtime crash / console error is streamed by the engine as BOTH
// an incident-report AND a forensic (crash) report with an identical `reason`,
// `url`, and `stackTrace`. Rendered naively that produces two cards for one
// fault, inflating the live Errors Tab count above the engine's
// `confirmedBugsMemory` (which registers the fault once) and above what is saved
// to history. This helper collapses each such pair into a single slot so the
// live view, the engine count, and the stored history stay 1:1.

import type { IncidentReport, ForensicCrashReport } from '../types';
import { buildFaultSignature } from '../../../shared/faultSignature.js';

/**
 * Stable fault identity: message signature + URL + originating stack frame +
 * status code. Both emissions of one fault share this key regardless of timestamp
 * skew; two distinct faults never collide just because their messages match. The
 * SINGLE identity used by dedup, ingest-collapse, and display grouping — and the
 * SAME normalization the backend applies at save time (shared/faultSignature), so
 * the live occurrence count and the persisted history count can never disagree.
 */
function faultKey(
  reason: string | undefined,
  url: string | undefined,
  stackTrace: string | undefined,
  statusCode: number | undefined,
): string {
  return buildFaultSignature({ reason, url, stackTrace, statusCode });
}

/**
 * Return only the crash reports that are NOT already represented by an incident
 * (identical fault KEY). Keying on reason+url+stack — identity alone, with no
 * timestamp window — fixes both prior failure modes: under-collapse (the same
 * fault whose two emissions drifted apart in time once the incident buffer
 * trimmed the early occurrence, inflating the count) and over-merge (two distinct
 * faults sharing a message, silently dropping a real one). The key is the fault
 * identity, so proximity in time is irrelevant. Reports with no matching incident
 * — e.g. a fatal crash emitted as a forensic report only — are always preserved.
 */
export function dedupeReportsAgainstIncidents(
  incidents: IncidentReport[],
  reports: ForensicCrashReport[],
): ForensicCrashReport[] {
  if (reports.length === 0 || incidents.length === 0) {
    return reports;
  }
  return reports.filter((report) =>
    !incidents.some((incident) =>
      faultKey(incident.reason, incident.url, incident.stackTrace, incident.statusCode) ===
        faultKey(report.reason, report.url, report.stackTrace, report.statusCode),
    ),
  );
}

// ─────────────────────────────────────────────────────────────
// Lossless occurrence grouping
// ─────────────────────────────────────────────────────────────
// The engine registers one finding PER OCCURRENCE (a JS exception re-thrown on
// every revisit, the same 5xx hit repeatedly), so identical faults pile up. This
// collapses them for DISPLAY only — the first is the representative, `count` is
// how many collapsed into it — without discarding any underlying record.

export interface FindingGroup<T> {
  item: T;
  count: number;
}

// Hidden per-representative breakdown: authoritative occurrence count keyed by the finding's
// bugId (legacy no-id emissions share the '' bucket). The displayed ×N is the SUM of its
// values, so re-delivering one bugId (the forensic→incident twin, a reconnect replay) is
// idempotent and can never inflate the count — only a genuinely distinct bugId adds.
const OCC_BY_BUG = '__occurrenceByBug' as const;
type Counted = { [OCC_BY_BUG]?: Record<string, number> };

function occKey(fault: { bugId?: string }): string {
  return fault.bugId ?? '';
}

function sumOcc(map: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(map)) total += v;
  return total;
}

// Merge a freshly-streamed fault into a bounded, newest-first buffer holding ONE entry per
// distinct fault (keyed by liveFaultSignature). The count is the sum of authoritative
// per-bugId occurrences — NEVER incremented on arrival. A repeat delivery of a known bugId
// overwrites (monotonically) that bug's authoritative value; a distinct bugId that shares the
// display signature contributes its own value. Repeats keep first-seen order; a new distinct
// fault appends to the bottom, and overflow drops from the head so the newest faults survive.
export function collapseFaultIntoBuffer<T extends IncidentReport | ForensicCrashReport>(
  prev: T[],
  incoming: T,
  cap = 100,
): T[] {
  const sig = liveFaultSignature(incoming);
  const existing = prev.find((f) => liveFaultSignature(f) === sig) as (T & Counted) | undefined;
  const key = occKey(incoming);
  const incomingCount = incoming.occurrences ?? 1;

  const byBug: Record<string, number> = { ...((existing as Counted | undefined)?.[OCC_BY_BUG] ?? {}) };
  // Monotonic per-bug seed: a hydrated row carries its true accumulated total; a live twin
  // carries 1. max() keeps the higher and makes redelivery idempotent.
  byBug[key] = Math.max(byBug[key] ?? 0, incomingCount);

  const merged = { ...incoming, occurrences: sumOcc(byBug), [OCC_BY_BUG]: byBug } as T & Counted;
  const next = existing
    ? prev.map((f) => (liveFaultSignature(f) === sig ? (merged as T) : f))
    : [...prev, merged as T];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// Apply an authoritative occurrence-count patch (finding-occurrence event) to the buffer: find
// the representative that owns this bugId and set its per-bug count to the running total, then
// recompute the displayed ×N. Monotonic — a stale, lower total never lowers the count. No-op if
// no card owns the bugId yet (the patch's incident always precedes it in practice).
export function applyOccurrencePatchToBuffer<T extends IncidentReport | ForensicCrashReport>(
  prev: T[],
  bugId: string,
  occurrences: number,
): T[] {
  if (!bugId || !Number.isFinite(occurrences)) return prev;
  let changed = false;
  const next = prev.map((f) => {
    const counted = f as T & Counted;
    const byBug = counted[OCC_BY_BUG];
    // A card owns the bugId if its breakdown tracks it, or (pre-breakdown legacy) its own id matches.
    const owns = byBug ? Object.prototype.hasOwnProperty.call(byBug, bugId) : f.bugId === bugId;
    if (!owns) return f;
    const map = { ...(byBug ?? { [bugId]: f.occurrences ?? 1 }) };
    if (occurrences <= (map[bugId] ?? 0)) return f;
    map[bugId] = occurrences;
    changed = true;
    return { ...f, occurrences: sumOcc(map), [OCC_BY_BUG]: map } as T;
  });
  return changed ? next : prev;
}

// Group items by a content signature, preserving first-seen order. `occurrenceOf`
// lets pre-collapsed items contribute their accumulated count (defaults to 1 so
// raw, un-collapsed buffers still count one-per-item).
export function groupBySignature<T>(
  items: T[],
  signature: (item: T) => string,
  occurrenceOf: (item: T) => number = () => 1,
): FindingGroup<T>[] {
  const order: string[] = [];
  const groups = new Map<string, FindingGroup<T>>();
  for (const item of items) {
    const key = signature(item);
    const existing = groups.get(key);
    if (existing) {
      existing.count += occurrenceOf(item);
    } else {
      groups.set(key, { item, count: occurrenceOf(item) });
      order.push(key);
    }
  }
  return order.map((key) => groups.get(key)!);
}

/** Visible-fault signature for live incidents/crash reports (reason + url + status). */
export function liveFaultSignature(fault: IncidentReport | ForensicCrashReport): string {
  return faultKey(fault.reason, fault.url, fault.stackTrace, fault.statusCode);
}

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

// Merge a freshly-streamed fault into a bounded, newest-first buffer that holds
// ONE entry per distinct fault (keyed by liveFaultSignature) with a running
// `occurrences` count. Repeats bump the count and move the fault to the front
// (refreshing the representative) instead of consuming a new slot — so a high-
// frequency fault can never flood `cap` and evict a rarer distinct fault.
export function collapseFaultIntoBuffer<T extends IncidentReport | ForensicCrashReport>(
  prev: T[],
  incoming: T,
  cap = 100,
): T[] {
  const sig = liveFaultSignature(incoming);
  const existing = prev.find((f) => liveFaultSignature(f) === sig);
  const merged = { ...incoming, occurrences: (existing?.occurrences ?? 0) + 1 } as T;
  const rest = existing ? prev.filter((f) => liveFaultSignature(f) !== sig) : prev;
  return [merged, ...rest].slice(0, cap);
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

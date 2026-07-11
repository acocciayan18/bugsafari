// ─────────────────────────────────────────────────────────────
// Live error de-duplication
// ─────────────────────────────────────────────────────────────
// A single JS runtime crash / console error is streamed by the engine as BOTH
// an incident-report AND a forensic (crash) report with an identical `reason`
// and a near-identical timestamp. Rendered naively that produces two cards for
// one fault, inflating the live Errors Tab count above the engine's
// `confirmedBugsMemory` (which registers the fault once) and above what is saved
// to history. This helper collapses each such pair into a single slot so the
// live view, the engine count, and the stored history stay 1:1.

import type { IncidentReport, ForensicCrashReport } from '../types';

// Generous window: the incident + forensic pair for ONE fault is emitted back-to-
// back by StabilityMonitor, so any real skew is well under this. It exists only to
// avoid collapsing two genuinely separate occurrences of the identical fault that
// happen far apart in a session — the fault KEY (below) does the real work.
const DEFAULT_WINDOW_MS = 2000;

function normalizeSignature(reason: string | undefined): string {
  return (reason ?? '').trim().toLowerCase();
}

// First non-empty stack line — distinguishes two faults that share a message/URL
// but originate at different call sites (so they are never wrongly merged).
function stackTop(stackTrace: string | undefined): string {
  if (!stackTrace) return '';
  for (const line of stackTrace.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.toLowerCase();
  }
  return '';
}

/**
 * Stable fault identity: message signature + URL + originating stack frame. Both
 * emissions of one fault share this key regardless of timestamp skew; two distinct
 * faults never collide just because their messages match.
 */
function faultKey(reason: string | undefined, url: string | undefined, stackTrace: string | undefined): string {
  return `${normalizeSignature(reason)}|${(url ?? '').trim().toLowerCase()}|${stackTop(stackTrace)}`;
}

function withinWindow(aTs: string | undefined, bTs: string | undefined, windowMs: number): boolean {
  const a = aTs ? Date.parse(aTs) : NaN;
  const b = bTs ? Date.parse(bTs) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= windowMs;
}

/**
 * Return only the crash reports that are NOT already represented by an incident
 * (identical fault KEY within `windowMs`). Keying on reason+url+stack — rather
 * than message + a tight timestamp window — fixes both prior failure modes:
 * under-collapse (the same fault whose two emissions were skewed past the old
 * 100 ms window, inflating the count) and over-merge (two distinct faults sharing
 * a message, silently dropping a real one). Reports with no matching incident —
 * e.g. a fatal crash emitted as a forensic report only — are always preserved.
 */
export function dedupeReportsAgainstIncidents(
  incidents: IncidentReport[],
  reports: ForensicCrashReport[],
  windowMs: number = DEFAULT_WINDOW_MS,
): ForensicCrashReport[] {
  if (reports.length === 0 || incidents.length === 0) {
    return reports;
  }
  return reports.filter((report) =>
    !incidents.some((incident) =>
      faultKey(incident.reason, incident.url, incident.stackTrace) ===
        faultKey(report.reason, report.url, report.stackTrace) &&
      withinWindow(incident.timestamp, report.timestamp, windowMs),
    ),
  );
}

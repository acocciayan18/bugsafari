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

const DEFAULT_WINDOW_MS = 100;

function normalizeSignature(reason: string | undefined): string {
  return (reason ?? '').trim().toLowerCase();
}

function withinWindow(aTs: string | undefined, bTs: string | undefined, windowMs: number): boolean {
  const a = aTs ? Date.parse(aTs) : NaN;
  const b = bTs ? Date.parse(bTs) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= windowMs;
}

/**
 * Return only the crash reports that are NOT already represented by an incident
 * (same message signature within `windowMs`). Reports with no matching incident
 * — e.g. a fatal crash emitted as a forensic report only — are preserved, so no
 * unique fault is ever dropped.
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
      normalizeSignature(incident.reason) === normalizeSignature(report.reason) &&
      withinWindow(incident.timestamp, report.timestamp, windowMs),
    ),
  );
}

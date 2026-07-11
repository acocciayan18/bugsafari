// ═══════════════════════════════════════════════════════════════
// __accuracy__/dedupCorpus.ts — LABELED DEDUPLICATION GROUND TRUTH
// ═══════════════════════════════════════════════════════════════
// Deterministic corpus for scoring dedupeReportsAgainstIncidents(). Each case is
// a live incident stream + a forensic-report stream with the correct number of
// reports that should SURVIVE dedup. Exercises both failure modes of the old
// timestamp-only pairing: under-collapse (same fault, timestamps skewed past the
// tight window ⇒ double count) and over-merge (distinct faults sharing a message
// within the window ⇒ a real fault silently dropped).

// Structural row types kept local so the corpus stays runtime-dependency-free;
// they mirror the shared IncidentReport / ForensicCrashReport shape the dedup
// helper consumes (reason + url + timestamp + optional stackTrace).
export interface DedupIncident {
  timestamp: string;
  reason: string;
  url: string;
  stackTrace?: string;
}
export interface DedupReport {
  timestamp: string;
  reason: string;
  url: string;
  stackTrace?: string;
}

export interface DedupCase {
  name: string;
  incidents: DedupIncident[];
  reports: DedupReport[];
  /** Correct number of reports remaining after dedup against the incidents. */
  expectedRemaining: number;
}

const T = (ms: number): string => new Date(1_700_000_000_000 + ms).toISOString();

export const DEDUP_CORPUS: readonly DedupCase[] = [
  {
    name: 'same fault, tight skew (<100ms) — must collapse',
    incidents: [{ timestamp: T(0), reason: 'Unhandled JS Exception: x is undefined', url: 'https://app.test/a' }],
    reports: [{ timestamp: T(40), reason: 'Unhandled JS Exception: x is undefined', url: 'https://app.test/a' }],
    expectedRemaining: 0,
  },
  {
    name: 'same fault, wide skew (>100ms) — must still collapse (key-based)',
    incidents: [{ timestamp: T(0), reason: 'Unhandled JS Exception: x is undefined', url: 'https://app.test/a' }],
    reports: [{ timestamp: T(350), reason: 'Unhandled JS Exception: x is undefined', url: 'https://app.test/a' }],
    expectedRemaining: 0, // old 100ms window under-collapsed here → double count
  },
  {
    name: 'distinct faults, same message, different url — must NOT merge',
    incidents: [{ timestamp: T(0), reason: 'Network request failed', url: 'https://app.test/a' }],
    reports: [{ timestamp: T(30), reason: 'Network request failed', url: 'https://app.test/b' }],
    expectedRemaining: 1, // old message+window over-merged here → real fault dropped
  },
  {
    name: 'distinct faults, same message + url, different stack — must NOT merge',
    incidents: [{ timestamp: T(0), reason: 'TypeError: cannot read x', url: 'https://app.test/a', stackTrace: 'at foo (a.js:1:1)' }],
    reports: [{ timestamp: T(20), reason: 'TypeError: cannot read x', url: 'https://app.test/a', stackTrace: 'at bar (b.js:9:9)' }],
    expectedRemaining: 1,
  },
  {
    name: 'forensic-only report (no matching incident) — must survive',
    incidents: [{ timestamp: T(0), reason: 'Some other fault', url: 'https://app.test/a' }],
    reports: [{ timestamp: T(10), reason: 'Fatal render crash', url: 'https://app.test/c' }],
    expectedRemaining: 1,
  },
  {
    name: 'genuine pair among noise — collapse only the match',
    incidents: [
      { timestamp: T(0), reason: 'Unhandled JS Exception: boom', url: 'https://app.test/x' },
      { timestamp: T(5), reason: 'unrelated', url: 'https://app.test/y' },
    ],
    reports: [
      { timestamp: T(250), reason: 'Unhandled JS Exception: boom', url: 'https://app.test/x' },
      { timestamp: T(260), reason: 'standalone forensic', url: 'https://app.test/z' },
    ],
    expectedRemaining: 1, // the "boom" pair collapses; the standalone survives
  },
];

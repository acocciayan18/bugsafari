import type { IncidentReport, TelemetryEvent } from '../../../../shared/types.js';
import type { ICaughtBug } from '../../infrastructure/database/models/SessionModel.js';
import { SessionModel } from '../../infrastructure/database/models/SessionModel.js';
import { telemetryEventRepository } from '../../infrastructure/database/repositories/TelemetryEventRepository.js';
import { SNAPSHOT_TELEMETRY_LIMIT } from '../../infrastructure/database/queryLimits.js';

/** Minimal shape a restore snapshot must expose to be hydrated. */
export interface HydratableSnapshot {
  sessionId?: string | null;
  telemetry?: TelemetryEvent[];
  incidents?: IncidentReport[];
  targetUrl?: string;
}

/**
 * Backfill a restore snapshot's telemetry from the durable Mongo stream so a
 * refreshed/reconnected client recovers the recent history, not just the capped
 * in-memory replay tail. Reads only the most-recent SNAPSHOT_TELEMETRY_LIMIT rows —
 * the client slices to that same window on hydrate, so shipping the full 5000-row
 * stream only inflated the payload and the synchronous parse before first paint.
 * Only replaces when the DB holds strictly more than the buffer, so an
 * empty/lagging collection never truncates a good in-memory snapshot.
 */
export async function hydrateTelemetryFromDb<T extends HydratableSnapshot | null>(snapshot: T): Promise<T> {
  if (!snapshot?.sessionId || !snapshot.telemetry) return snapshot;
  const rows = await telemetryEventRepository.findRecentByRunId(snapshot.sessionId, SNAPSHOT_TELEMETRY_LIMIT).catch(() => []);
  if (rows.length > snapshot.telemetry.length) snapshot.telemetry = rows;
  return snapshot;
}

/** Render one checkpointed finding back onto the wire shape the Errors tab consumes. */
export function toIncidentReport(bug: ICaughtBug, fallbackUrl: string): IncidentReport {
  return {
    bugId: bug.bugId,
    timestamp: (bug.timestamp instanceof Date ? bug.timestamp : new Date(bug.timestamp ?? 0)).toISOString(),
    reason: bug.message ?? '',
    // Findings checkpointed before `url` existed carry none; the run's target is the
    // honest fallback rather than an empty card.
    url: bug.url || fallbackUrl,
    stackTrace: bug.stackTrace,
    resolvedStackTrace: bug.resolvedStackTrace,
    // The per-finding replay timeline is stored as ActionStepTrace, which is a
    // narrated projection rather than the raw ActionRecord the live card carried.
    // Steps are left empty instead of being faked; the playbook is what the operator
    // actually reads, and repro steps must never be reconstructed (see reproduction.ts).
    steps: [],
    reproductionPlaybook: bug.reproductionSteps,
    advice: bug.advice,
    // The schema stores attribution's enum members as bare strings; the values were
    // written by the engine from the narrow unions, so widening back is safe here.
    attribution: bug.attribution as IncidentReport['attribution'],
    occurrences: bug.occurrences,
    severity: bug.severity as IncidentReport['severity'],
    stateFingerprint: bug.stateFingerprint,
    culpritSelector: bug.selector || undefined,
    culpritLabel: bug.elementLabel || undefined,
  };
}

/**
 * Backfill a restore snapshot's findings from the engine's mid-run checkpoint.
 *
 * The in-memory replay buffer is capped at REPORT_BUFFER_CAP (100) and the worker's
 * Redis snapshot expires, so a long run's earliest findings were unreachable to a
 * refreshed client even though the backend still held them. Same conservative rule as
 * the telemetry backfill: replace only when the durable copy holds strictly more.
 */
export async function hydrateFindingsFromDb<T extends HydratableSnapshot | null>(snapshot: T): Promise<T> {
  if (!snapshot?.sessionId || !snapshot.incidents) return snapshot;
  // Unscoped by userId on purpose, and safe: `sessionId` is never client input. It comes
  // off a snapshot the caller has ALREADY proven ownership of — the registry-entry check
  // in /api/session/active, or ownsQueuedRun on attach — so the tenant boundary is
  // enforced upstream, exactly as it is for the telemetry backfill above.
  const doc = await SessionModel.findById(snapshot.sessionId)
    .select('forensicTrace.caughtBugs')
    .lean()
    .catch(() => null);
  const bugs = doc?.forensicTrace?.caughtBugs ?? [];
  if (bugs.length <= snapshot.incidents.length) return snapshot;
  const fallbackUrl = snapshot.targetUrl ?? '';
  snapshot.incidents = bugs
    // ACCESSIBILITY findings are ephemeral and ride their own channel; they must never
    // appear in the Errors tab's incident list.
    .filter((bug) => bug.type !== 'ACCESSIBILITY')
    .slice(-SNAPSHOT_TELEMETRY_LIMIT)
    .map((bug) => toIncidentReport(bug, fallbackUrl));
  return snapshot;
}

/** Both backfills, in the order a restore path always wants them. */
export async function hydrateSnapshotFromDb<T extends HydratableSnapshot | null>(snapshot: T): Promise<T> {
  await hydrateTelemetryFromDb(snapshot);
  return hydrateFindingsFromDb(snapshot);
}

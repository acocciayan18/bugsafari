import type { FaultSeverity, InfiltrationProfileId, RunTerminationOutcome, SessionHistoryEntry, SessionHistoryState } from '../../types';
import { summarizeSeverity } from '../../types';

export interface CaughtBug {
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: string;
}

export interface ForensicTrace {
    finalBreadcrumbSteps: string[];
    caughtBugs: CaughtBug[];
}

export interface EvaluationSafari {
    // Public identifier used for ALL routing/lookups (navigate, delete, export,
    // compare, React keys) — the RUN- code, never the internal Mongo _id.
    id: string;
    // Same public RUN- code, kept for the searchable/display field.
    runId?: string;
    targetUrl: string;
    date: string;
    /** Epoch ms of the run's start — the sortable truth behind the display `date`. */
    startedAtMs: number;
    steps: number;
    /** Active/Archived/Trash bucket, so the row menu can offer the right actions. */
    state: SessionHistoryState;
    /** Worst real severity present among the findings; 'CLEAR' when there are none. */
    severity: FaultSeverity | 'CLEAR';
    /** Findings at {@link severity} (the worst tier) — what the badge counts. */
    severityCount: number;
    /** Total findings across all severities — the importance/delete-gate input. */
    findingCount: number;
    status: 'COMPLETED' | 'CRASHED' | 'HALTED' | 'STOPPED' | 'TIMEOUT' | 'ABANDONED' | 'ENGINE_ERROR';
    /** Precise termination taxonomy; drives the displayed reason when present. */
    outcome?: RunTerminationOutcome;
    /** Infiltration profile the run executed; absent on rows saved before it was tracked. */
    infiltrationProfile?: InfiltrationProfileId;
    endedReason?: string;
    timeElapsed: number;
    bugsByCategory: Record<string, number>;
    forensicTrace: ForensicTrace;
}

export type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CLEAR';
export type SortField = 'date' | 'severity' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
    field: SortField;
    direction: SortDirection;
}

export const ITEMS_PER_PAGE = 10;

// Full-tier ranking for the severity sort (worst → best); CLEAR sinks to the bottom.
export const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1, CLEAR: 0 };

// Clean endings sort above fault endings; unattended endings sit between them.
export const STATUS_ORDER: Record<string, number> = {
    COMPLETED: 7, TIMEOUT: 6, STOPPED: 5, HALTED: 4, ABANDONED: 3, ENGINE_ERROR: 2, CRASHED: 1,
};

export const SORT_FIELD_LABELS: Record<SortField, string> = {
    date: 'Date',
    severity: 'Severity',
    status: 'Status',
};

const SESSION_STATUS_MAP: Record<SessionHistoryEntry['status'], EvaluationSafari['status']> = {
    Completed: 'COMPLETED',
    Crashed: 'CRASHED',
    Stopped: 'STOPPED',
    TimedOut: 'TIMEOUT',
    Halted: 'HALTED',
    Abandoned: 'ABANDONED',
    EngineError: 'ENGINE_ERROR',
    Running: 'HALTED',
};

// Legacy fallback ONLY: rows saved before severityCounts existed carry no per-finding
// severity, so approximate the tier from the total count (the old behavior). Real rows
// go through summarizeSeverity instead.
function legacySeverityFromCount(bugCount: number): EvaluationSafari['severity'] {
    if (bugCount >= 3) return 'CRITICAL';
    if (bugCount >= 1) return 'HIGH';
    return 'CLEAR';
}

// Worst tier + its count from the authoritative per-severity tally, with a graceful
// fallback for legacy rows that predate it.
function resolveBadge(entry: SessionHistoryEntry): { severity: EvaluationSafari['severity']; severityCount: number } {
    const summary = summarizeSeverity(entry.severityCounts);
    if (summary.total > 0) return { severity: summary.severity, severityCount: summary.count };
    // No real severity data: keep old rows truthful about having findings.
    const findingCount = entry.findingCount ?? 0;
    return { severity: legacySeverityFromCount(findingCount), severityCount: findingCount };
}

// Epoch ms for sorting; 0 for an absent/unparsable timestamp so it sinks to the end.
function toEpochMs(dateStr: string): number {
    const parsed = Date.parse(dateStr);
    return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
    }).toUpperCase();
}

export function transformSessionsToEvaluations(sessions: SessionHistoryEntry[]): EvaluationSafari[] {
    return sessions.map((session) => ({
        // Public code is the canonical id everywhere in the UI; the raw _id
        // (session.id) is only a defensive fallback for a legacy row without one.
        id: session.runId ?? session.id,
        runId: session.runId,
        targetUrl: session.targetUrl,
        date: formatDate(session.startedAt),
        startedAtMs: toEpochMs(session.startedAt),
        steps: session.actionTraceCount,
        state: session.state ?? 'active',
        ...resolveBadge(session),
        findingCount: session.findingCount,
        status: SESSION_STATUS_MAP[session.status] ?? 'HALTED',
        outcome: session.outcome,
        infiltrationProfile: session.infiltrationProfile,
        endedReason: session.endedReason,
        timeElapsed: session.runtimeMs ?? 0,
        bugsByCategory: {},
        forensicTrace: { finalBreadcrumbSteps: [], caughtBugs: [] },
    }));
}

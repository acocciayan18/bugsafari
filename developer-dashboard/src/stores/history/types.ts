import type { RunTerminationOutcome, SessionHistoryEntry } from '../../types';

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
    severity: 'CRITICAL' | 'HIGH' | 'CLEAR';
    severityCount: number;
    status: 'COMPLETED' | 'CRASHED' | 'HALTED' | 'STOPPED' | 'TIMEOUT' | 'ABANDONED';
    /** Precise termination taxonomy; drives the displayed reason when present. */
    outcome?: RunTerminationOutcome;
    endedReason?: string;
    timeElapsed: number;
    bugsByCategory: Record<string, number>;
    forensicTrace: ForensicTrace;
}

export type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'CLEAR';
export type SortField = 'date' | 'severity' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
    field: SortField;
    direction: SortDirection;
}

export const ITEMS_PER_PAGE = 10;

export const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 3, HIGH: 2, CLEAR: 1 };

// Clean endings sort above fault endings; unattended endings sit between them.
export const STATUS_ORDER: Record<string, number> = {
    COMPLETED: 6, TIMEOUT: 5, STOPPED: 4, HALTED: 3, ABANDONED: 2, CRASHED: 1,
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
    Running: 'HALTED',
};

function determineSeverity(bugCount: number): EvaluationSafari['severity'] {
    if (bugCount >= 3) return 'CRITICAL';
    if (bugCount >= 1) return 'HIGH';
    return 'CLEAR';
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
        severity: determineSeverity(session.findingCount),
        severityCount: session.findingCount,
        status: SESSION_STATUS_MAP[session.status] ?? 'HALTED',
        outcome: session.outcome,
        endedReason: session.endedReason,
        timeElapsed: session.runtimeMs ?? 0,
        bugsByCategory: {},
        forensicTrace: { finalBreadcrumbSteps: [], caughtBugs: [] },
    }));
}

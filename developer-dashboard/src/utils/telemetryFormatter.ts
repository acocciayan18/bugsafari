/**
 * Telemetry Formatter Utilities
 * 
 * Pure functions for formatting, severity classification, and diagnostic extraction.
 * Extracted from TelemetryStream.tsx to follow SRP.
 * 
 * Responsibilities:
 * - Event description generation
 * - Severity classification
 * - Diagnostic string extraction
 * - Filter predicates for telemetry processing
 */

import type {
    TelemetryEvent,
    ActionTelemetryMeta,
    NetworkTelemetryMeta,
    ExceptionTelemetryMeta,
    HeuristicScoreTelemetryMeta,
    BugTelemetryMeta,
} from '../types';

// ─────────────────────────────────────────────────────────────
// Output Types
// ─────────────────────────────────────────────────────────────

export type Pill = {
    label: string;
    color: string;
};

export type DescribeResult = {
    title: string;
    sub: string;
    pill: Pill;
};

// ─────────────────────────────────────────────────────────────
// Event Description Generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate human-readable description for a telemetry event.
 * Uses discriminated union type narrowing for type-safe access.
 */
export function describeEvent(event: TelemetryEvent): DescribeResult {
    switch (event.type) {
        case 'EXCEPTION':
            return describeExceptionEvent(event.meta);
        case 'HEURISTIC_SCORE':
            return describeHeuristicEvent(event.meta);
        case 'NETWORK':
            return describeNetworkEvent(event.meta);
        case 'BUG':
            return describeBugEvent(event.meta);
        case 'ACTION':
        default:
            return describeActionEvent(event.meta);
    }
}

function describeExceptionEvent(meta: ExceptionTelemetryMeta): DescribeResult {
    const msg = (meta.message ?? '').toLowerCase();
    const isFatal = msg.includes('fatal') || msg.includes('halt');

    // Extract AI diagnostics for remediation display
    const aiDiagnostics = meta.aiDiagnostics;
    let sub = meta.message ?? 'Runtime exception captured';

    // If AI diagnostics available, show the suggested fix
    if (aiDiagnostics) {
        const fixPreview = aiDiagnostics.suggestedFix?.slice(0, 100);
        sub = fixPreview ? `${fixPreview}...` : sub;
    }

    return {
        pill: {
            label: isFatal ? 'ERROR' : 'WARNING',
            color: isFatal ? 'bg-[#EF4444] text-white' : 'bg-[#F59E0B] text-white',
        },
        title: meta.message ? meta.message : 'Exception',
        sub,
    };
}

function describeHeuristicEvent(meta: HeuristicScoreTelemetryMeta): DescribeResult {
    return {
        pill: { label: 'STEP', color: 'bg-[#10A37F] text-white' },
        title: meta.message ?? `Score update`,
        sub: meta.selector ? `target: ${meta.selector}` : 'heuristic',
    };
}

function describeNetworkEvent(meta: NetworkTelemetryMeta): DescribeResult {
    const statusCode = meta.statusCode ?? meta.status;
    const isError = statusCode !== undefined && statusCode >= 400;

    return {
        pill: {
            label: isError ? 'ERROR' : 'NET',
            color: isError ? 'bg-[#EF4444] text-white' : 'bg-[#6B7280] text-white',
        },
        title: meta.message ?? `${meta.method ?? 'REQ'} ${meta.url ?? ''}`,
        sub: statusCode ? `${statusCode} (${meta.durationMs}ms)` : `${meta.durationMs ?? 0}ms`,
    };
}

function describeBugEvent(meta: BugTelemetryMeta): DescribeResult {
    return {
        pill: {
            label: meta.severity ?? 'BUG',
            color: meta.severity === 'CRITICAL'
                ? 'bg-[#EF4444] text-white'
                : 'bg-[#F59E0B] text-white',
        },
        title: meta.message ?? 'Bug detected',
        sub: meta.selector ? `selector: ${meta.selector}` : 'bug analysis',
    };
}

function describeActionEvent(meta: ActionTelemetryMeta): DescribeResult {
    return {
        pill: { label: 'STEP', color: 'bg-[#111827] text-white' },
        title: meta.message ?? meta.actionExecuted ?? 'ACTION',
        sub: meta.actionExecuted ?? 'engine action',
    };
}

// ─────────────────────────────────────────────────────────────
// Severity Classification
// ─────────────────────────────────────────────────────────────

/**
 * Classify severity level based on telemetry event.
 */
export function classifySeverity(event: TelemetryEvent): 'CRITICAL' | 'WARNING' | 'INFO' {
    switch (event.type) {
        case 'EXCEPTION': {
            const msg = (event.meta.message ?? '').toLowerCase();
            if (msg.includes('fatal') || msg.includes('halt')) {
                return 'CRITICAL';
            }
            return 'WARNING';
        }
        case 'BUG': {
            return event.meta.severity ?? 'WARNING';
        }
        case 'NETWORK': {
            const statusCode = event.meta.statusCode ?? event.meta.status;
            if (statusCode !== undefined && statusCode >= 500) {
                return 'CRITICAL';
            }
            if (statusCode !== undefined && statusCode >= 400) {
                return 'WARNING';
            }
            return 'INFO';
        }
        case 'HEURISTIC_SCORE':
            return 'INFO';
        case 'ACTION':
        default:
            return 'INFO';
    }
}

/**
 * Check if event is considered high-priority.
 */
export function isHighPriority(event: TelemetryEvent): boolean {
    return classifySeverity(event) === 'CRITICAL';
}

// ─────────────────────────────────────────────────────────────
// Filter Predicates
// ─────────────────────────────────────────────────────────────

/**
 * Low-signal action keywords to filter out from display.
 */
const LOW_SIGNAL_ACTIONS = new Set([
    'dom-snapshot',
    'capture-visual',
    'update-viewport',
    'poll',
    'tick',
]);

/**
 * Check if event should be displayed in the telemetry timeline.
 * Filters out noisy NETWORK events and low-signal ACTIONs.
 */
export function shouldDisplayEvent(event: TelemetryEvent): boolean {
    // Hide noisy network events
    if (event.type === 'NETWORK') return false;

    // Filter low-signal action events
    if (event.type === 'ACTION') {
        const action = event.meta.actionExecuted?.toLowerCase() ?? '';
        for (const lowSignal of LOW_SIGNAL_ACTIONS) {
            if (action.includes(lowSignal)) return false;
        }
    }

    return true;
}

// ─────────────────────────────────────────────────────────────
// Sorting Utilities
// ─────────────────────────────────────────────────────────────

/**
 * Sort telemetry events by timestamp (newest first).
 * Maintains stable ordering for same timestamp.
 */
export function sortEventsByTimestamp(
    events: TelemetryEvent[]
): TelemetryEvent[] {
    return [...events].sort((a, b) =>
        a.timestamp < b.timestamp ? 1 : -1
    );
}

/**
 * Sort telemetry events by timestamp (oldest first).
 */
export function sortEventsChronological(
    events: TelemetryEvent[]
): TelemetryEvent[] {
    return [...events].sort((a, b) =>
        a.timestamp > b.timestamp ? 1 : -1
    );
}

/**
 * BugClassifier - Centralized bug validation service
 * 
 * Single source of truth for determining what constitutes an actual bug.
 * Ensures consistent filtering across the entire application.
 */

interface BugMeta {
    statusCode?: number;
    status?: number;
    message?: string;
    severity?: 'CRITICAL' | 'WARNING' | 'INFO';
    [key: string]: unknown;
}

/**
 * Non-bug types that should NOT be counted as bugs.
 * These are healthy system telemetry, not actual bugs.
 */
const NON_BUG_TYPES = ['ACTION', 'HEURISTIC_SCORE'] as const;

/**
 * Valid bug types that should be counted as actual bugs.
 */
const VALID_BUG_TYPES = new Set([
    'EXCEPTION',
    'RUNTIME_UI_FREEZE',
    'SESSION_SYNC_FAULT',
    'NETWORK',
]);

/**
 * Critical strings that indicate a NETWORK bug even with status < 400.
 * These represent server/system-level issues.
 */
const CRITICAL_NETWORK_STRINGS = [
    'server collapse',
    'system lock-up',
    'exception',
    'fatal',
    'crash',
];

/**
 * Check if a bug is an actual bug that should be saved/tracked.
 * 
 * Rules:
 * - EXCEPTION, RUNTIME_UI_FREEZE, SESSION_SYNC_FAULT are always valid bugs
 * - NETWORK bugs are only valid if:
 *   - Status code >= 400, OR
 *   - Message contains critical strings like "Server Collapse", "System Lock-up", "Exception"
 * - Normal 200 requests with no critical strings return false
 * - ACTION and HEURISTIC_SCORE are never bugs
 */
export function isActualBug(type: string, meta?: BugMeta): boolean {
    const bugType = type?.toUpperCase();

    // Always exclude non-bug types
    if (bugType && NON_BUG_TYPES.includes(bugType as typeof NON_BUG_TYPES[number])) {
        return false;
    }

    // For NETWORK type, apply strict filtering
    if (bugType === 'NETWORK') {
        const statusCode = meta?.statusCode ?? meta?.status;

        // If status >= 400, it's definitely a bug
        if (typeof statusCode === 'number' && statusCode >= 400) {
            return true;
        }

        // Check for critical strings in the message
        const message = meta?.message?.toLowerCase() ?? '';
        const hasCriticalString = CRITICAL_NETWORK_STRINGS.some(critical =>
            message.includes(critical.toLowerCase())
        );

        if (hasCriticalString) {
            return true;
        }

        // No status code but has network error - treat as bug
        if (!statusCode && message.length > 0) {
            return true;
        }

        // Normal 200 requests with no critical strings - not a bug
        return false;
    }

    // Include only valid bug types
    return Boolean(bugType && VALID_BUG_TYPES.has(bugType));
}

/**
 * Check if two bugs are duplicates.
 * Two bugs are duplicates if they have the exact same type AND message (or selector).
 */
export function isDuplicate(
    existing: { type: string; message?: string; selector?: string },
    candidate: { type: string; message?: string; selector?: string }
): boolean {
    const sameType = existing.type === candidate.type;
    const sameMessage = existing.message === candidate.message;
    const sameSelector = existing.selector === candidate.selector;

    // Consider duplicate if type matches AND (message matches OR selector matches)
    return sameType && (sameMessage || sameSelector);
}

export class BugClassifier {
    /**
     * Validate if a bug should be saved.
     * Uses the isActualBug function internally.
     */
    static isValidBug(type: string, meta?: BugMeta): boolean {
        return isActualBug(type, meta);
    }
}

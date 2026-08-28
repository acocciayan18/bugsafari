import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useHistoryStore } from './historyStore';
import { ITEMS_PER_PAGE, SEVERITY_ORDER, STATUS_ORDER, type EvaluationSafari, type SeverityFilter, type SortConfig } from './types';

// Match a row against the severity control by its real worst tier. Each tab is an
// exact tier match; the rare INFO tier folds into Low, so every row is still reachable
// from exactly one non-ALL tab (full partition).
function matchesSeverity(item: EvaluationSafari, filter: SeverityFilter): boolean {
    switch (filter) {
        case 'ALL': return true;
        case 'CRITICAL': return item.severity === 'CRITICAL';
        case 'HIGH': return item.severity === 'HIGH';
        case 'MEDIUM': return item.severity === 'MEDIUM';
        case 'LOW': return item.severity === 'LOW' || item.severity === 'INFO';
        case 'CLEAR': return item.severity === 'CLEAR';
        default: return true;
    }
}

function compare(a: EvaluationSafari, b: EvaluationSafari, { field }: SortConfig): number {
    switch (field) {
        // Sort on the underlying timestamp, never the formatted label —
        // "DEC 01, 2025" sorts before "JAN 02, 2026" alphabetically, which is wrong.
        case 'date': return a.startedAtMs - b.startedAtMs;
        case 'severity': return (SEVERITY_ORDER[a.severity] ?? 0) - (SEVERITY_ORDER[b.severity] ?? 0);
        case 'status': return (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0);
        default: return 0;
    }
}

export interface HistoryView {
    page: EvaluationSafari[];
    /** Clamped page — the raw index can outlive the list it was valid for. */
    safePage: number;
    totalPages: number;
    showingStart: number;
    showingEnd: number;
    matchedCount: number;
    totalCount: number;
    isFiltered: boolean;
}

// Filter → sort → paginate over the centralized state. Memoized per input so the
// full pipeline only re-runs when the list or a control actually changes.
export function useHistoryView(): HistoryView {
    const { sessions, searchQuery, activeFilter, sortConfig, currentPage } = useHistoryStore(
        useShallow((s) => ({
            sessions: s.sessions,
            searchQuery: s.searchQuery,
            activeFilter: s.activeFilter,
            sortConfig: s.sortConfig,
            currentPage: s.currentPage,
        }))
    );

    return useMemo(() => {
        const needle = searchQuery.trim().toLowerCase();
        const filtered = sessions.filter((item) => {
            const matchesSearch =
                needle === '' ||
                item.targetUrl.toLowerCase().includes(needle) ||
                (item.runId?.toLowerCase().includes(needle) ?? false) ||
                item.id.toLowerCase().includes(needle);
            return matchesSearch && matchesSeverity(item, activeFilter);
        });

        const multiplier = sortConfig.direction === 'asc' ? 1 : -1;
        const sorted = [...filtered].sort((a, b) => multiplier * compare(a, b, sortConfig));

        const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
        const safePage = Math.min(currentPage, totalPages);
        const startIdx = (safePage - 1) * ITEMS_PER_PAGE;

        return {
            page: sorted.slice(startIdx, startIdx + ITEMS_PER_PAGE),
            safePage,
            totalPages,
            showingStart: sorted.length > 0 ? startIdx + 1 : 0,
            showingEnd: Math.min(startIdx + ITEMS_PER_PAGE, sorted.length),
            matchedCount: sorted.length,
            totalCount: sessions.length,
            isFiltered: sorted.length !== sessions.length,
        };
    }, [sessions, searchQuery, activeFilter, sortConfig, currentPage]);
}

import { create } from 'zustand';
import type { ForensicReportResponse } from '../../types';
import { fetchSessionHistory, fetchForensicReport } from '../../services/historyService';
import { useAuthStore } from '../authStore';
import {
    transformSessionsToEvaluations,
    ITEMS_PER_PAGE,
    type EvaluationSafari,
    type SeverityFilter,
    type SortConfig,
} from './types';

// Returning from a forensic report inside this window reuses the cached list
// instead of refetching; the Refresh button always forces a round-trip.
const LIST_TTL_MS = 60_000;

// Non-reactive request bookkeeping — deduping in-flight calls must not notify subscribers.
const inflightReports = new Map<string, Promise<ForensicReportResponse>>();
let inflightList: Promise<void> | null = null;

export interface HistoryState {
    sessions: EvaluationSafari[];
    isLoading: boolean;
    error: string | null;
    lastFetchedAt: number;

    searchQuery: string;
    activeFilter: SeverityFilter;
    sortConfig: SortConfig;
    currentPage: number;

    reportCache: Record<string, ForensicReportResponse>;

    fetchSessions: (force?: boolean) => Promise<void>;
    removeSession: (id: string) => void;
    loadReport: (sessionId: string) => Promise<ForensicReportResponse>;
    setSearchQuery: (searchQuery: string) => void;
    setActiveFilter: (activeFilter: SeverityFilter) => void;
    setSortConfig: (update: (previous: SortConfig) => SortConfig) => void;
    setCurrentPage: (update: (previous: number) => number) => void;
    reset: () => void;
}

const INITIAL = {
    sessions: [] as EvaluationSafari[],
    isLoading: true,
    error: null as string | null,
    lastFetchedAt: 0,
    searchQuery: '',
    activeFilter: 'ALL' as SeverityFilter,
    sortConfig: { field: 'date', direction: 'desc' } as SortConfig,
    currentPage: 1,
    reportCache: {} as Record<string, ForensicReportResponse>,
};

export const useHistoryStore = create<HistoryState>((set, get) => ({
    ...INITIAL,

    fetchSessions: async (force = false) => {
        if (!useAuthStore.getState().token) {
            set({ isLoading: false, sessions: [], error: null });
            return;
        }
        if (inflightList) return inflightList;

        const { lastFetchedAt, sessions } = get();
        const isFresh = Date.now() - lastFetchedAt < LIST_TTL_MS;
        if (!force && isFresh && sessions.length > 0) {
            set({ isLoading: false });
            return;
        }

        set({ isLoading: true, error: null });

        inflightList = (async () => {
            try {
                const fetched = await fetchSessionHistory();
                set({ sessions: transformSessionsToEvaluations(fetched), lastFetchedAt: Date.now() });
            } catch (err) {
                set({ error: err instanceof Error ? err.message : 'Unknown error' });
                console.error('[historyStore] Fetch error:', err);
            } finally {
                set({ isLoading: false });
                inflightList = null;
            }
        })();

        return inflightList;
    },

    // Optimistic removal so the list settles without a second round-trip; the stale
    // report entry goes with it, and the page index is clamped to the shrunk list.
    removeSession: (id) => {
        const sessions = get().sessions.filter((item) => item.id !== id);
        const reportCache = { ...get().reportCache };
        delete reportCache[id];
        const lastPage = Math.max(1, Math.ceil(sessions.length / ITEMS_PER_PAGE));
        set({ sessions, reportCache, currentPage: Math.min(get().currentPage, lastPage) });
    },

    loadReport: async (sessionId) => {
        const cached = get().reportCache[sessionId];
        if (cached) return cached;

        const pending = inflightReports.get(sessionId);
        if (pending) return pending;

        const request = fetchForensicReport(sessionId)
            .then((report) => {
                set((s) => ({ reportCache: { ...s.reportCache, [sessionId]: report } }));
                return report;
            })
            .finally(() => {
                inflightReports.delete(sessionId);
            });

        inflightReports.set(sessionId, request);
        return request;
    },

    // Any change to the result set invalidates the page index — staying on page 3
    // of a newly-filtered list renders an empty table with no explanation.
    setSearchQuery: (searchQuery) => set({ searchQuery, currentPage: 1 }),
    setActiveFilter: (activeFilter) => set({ activeFilter, currentPage: 1 }),
    setSortConfig: (update) => set((s) => ({ sortConfig: update(s.sortConfig), currentPage: 1 })),
    setCurrentPage: (update) => set((s) => ({ currentPage: Math.max(1, update(s.currentPage)) })),

    reset: () => {
        inflightReports.clear();
        inflightList = null;
        set({ ...INITIAL });
    },
}));

let initialized = false;

// History is per-tenant: a token change must drop every cached session and report
// before the next user's list can render.
export function initHistoryStore(): void {
    if (initialized) return;
    initialized = true;

    useAuthStore.subscribe((state, prev) => {
        if (state.token === prev.token) return;
        useHistoryStore.getState().reset();
    });
}

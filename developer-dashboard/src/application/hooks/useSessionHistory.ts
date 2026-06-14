/**
 * useSessionHistory Hook
 * 
 * Handles fetching and storing past test runs.
 * Extracted from useDashboardController.ts to fix SRP violation.
 * 
 * Responsibilities:
 * - Fetching session history from gateway
 * - Storing session history in state
 * - Save session to history
 * - Refresh history
 */

import { useState, useCallback } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { SessionHistoryEntry, TelemetryEvent } from '../../types';
import { saveSessionToHistory } from '../../services/historyService';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DEFAULT_HISTORY_LIMIT = 60;

// ─────────────────────────────────────────────────────────────
// State Interfaces (ISP: Split DashboardState)
// ─────────────────────────────────────────────────────────────

export interface SessionHistoryState {
    sessionHistory: SessionHistoryEntry[];
    isSavingSession: boolean;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useSessionHistory(
    gateway: EngineGateway,
    onTelemetry?: (event: TelemetryEvent) => void
) {
    // History state
    const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
    const [isSavingSession, setIsSavingSession] = useState(false);

    // ─────────────────────────────────────────────────────────────
    // History Actions
    // ─────────────────────────────────────────────────────────────

    // Fetch session history
    const fetchHistory = useCallback(async (limit = DEFAULT_HISTORY_LIMIT) => {
        try {
            const history = await gateway.fetchSessionHistory(limit);
            setSessionHistory(history);
            return history;
        } catch (error) {
            console.error('[useSessionHistory] Failed to fetch history:', error);
            return [];
        }
    }, [gateway]);

    // Refresh history (alias for fetchHistory)
    const refreshHistory = useCallback(async () => {
        return fetchHistory(DEFAULT_HISTORY_LIMIT);
    }, [fetchHistory]);

    // Save current session
    const saveSession = useCallback(async (inputTargetUrl: string): Promise<void> => {
        if (isSavingSession) {
            return;
        }

        setIsSavingSession(true);
        try {
            // Use the historyService that tracks both URLs
            // If runtimeUrl available, use it; otherwise use input URL
            const runtimeUrl = inputTargetUrl;

            await saveSessionToHistory(runtimeUrl.trim(), { initialUrl: inputTargetUrl.trim() });

            // Refresh after save
            await refreshHistory();

            // Emit save success telemetry
            onTelemetry?.({
                timestamp: new Date().toISOString(),
                type: 'ACTION' as const,
                meta: {
                    actionExecuted: 'session-saved',
                    message: 'Session has been committed to history.'
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            // Emit error telemetry
            onTelemetry?.({
                timestamp: new Date().toISOString(),
                type: 'EXCEPTION' as const,
                meta: { message: `Save Session failed: ${message}` },
            });

            throw error;
        } finally {
            setIsSavingSession(false);
        }
    }, [gateway, refreshHistory, onTelemetry, isSavingSession]);

    // Clear history (for testing/reset)
    const clearHistory = useCallback(() => {
        setSessionHistory([]);
    }, []);

    // ─────────────────────────────────────────────────────────────
    // State Object
    // ─────────────────────────────────────────────────────────────

    const state: SessionHistoryState = {
        sessionHistory,
        isSavingSession,
    };

    const actions = {
        fetchHistory,
        refreshHistory,
        saveSession,
        clearHistory,
    };

    return { state, actions };
}

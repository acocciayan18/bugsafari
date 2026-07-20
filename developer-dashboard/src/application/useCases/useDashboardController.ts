import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../stores/authStore';
import { useRunStore } from '../../stores/run/runStore';
import { initRunTimer } from '../../stores/run/runTimer';
import { bindGatewayToRunStore, connectAndRestore } from '../../stores/run/gatewayBinding';
import { startRun, pauseRun, resumeRun, stopRun, saveRun, refreshHistory } from '../../stores/run/runCommands';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';

export type { TestSessionStatus } from '../../stores/run/types';
export type { RunState as DashboardState } from '../../stores/run/runStore';

const INITIALIZATION_TIMEOUT_MS = 30000;

// Ref-counted so StrictMode's synthetic unmount never disconnects a live socket
let mountCount = 0;
let bound = false;

function useRunSession(): void {
    useEffect(() => {
        mountCount += 1;
        const gateway = getEngineGateway();

        if (!bound) {
            bound = true;
            initRunTimer();
            bindGatewayToRunStore(gateway);
            connectAndRestore(gateway);
        }

        return () => {
            mountCount -= 1;
            // Only the last unmount tears down; otherwise navigating between routes
            // would deafen the socket for the rest of the session.
            if (mountCount > 0) return;
            bound = false;
            gateway.disconnect();
            gateway.removeAllListeners();
        };
    }, []);

    // Keep the singleton's auth token current or authenticated HTTP calls go out bare
    useEffect(() => {
        const gateway = getEngineGateway();
        gateway.setAuthToken(useAuthStore.getState().token);
        return useAuthStore.subscribe((state, prev) => {
            if (state.token !== prev.token) gateway.setAuthToken(state.token);
        });
    }, []);
}

// Watchdog: no live frame within 30s means the engine never came up. Dispatch a
// backend stop so orphaned processes die, then release the UI.
function useInitializationWatchdog(isInitializing: boolean, isTestRunning: boolean): void {
    const dispatchedRef = useRef(false);

    useEffect(() => {
        if (!isInitializing || !isTestRunning) {
            dispatchedRef.current = false;
            return;
        }

        const timeout = setTimeout(async () => {
            if (dispatchedRef.current) return;
            dispatchedRef.current = true;

            console.warn('[useDashboardController] Initialization timeout reached - dispatching cleanup to backend');
            useRunStore.getState().setCleaningUp(true);

            try {
                const gateway = getEngineGateway() as unknown as { forceStop?: () => Promise<void> };
                if (typeof gateway.forceStop === 'function') {
                    await gateway.forceStop();
                    console.log('[useDashboardController] Cleanup dispatched to backend');
                }
            } catch (error) {
                console.error('[useDashboardController] Cleanup dispatch failed:', error);
            }

            useRunStore.setState({
                isThinking: false,
                isInitializing: false,
                isCleaningUp: false,
                isTestRunning: false,
                status: 'IDLE',
            });
            useRunStore.getState().pushTelemetry({
                timestamp: new Date().toISOString(),
                type: 'EXCEPTION',
                meta: { message: 'Engine initialization timeout: No live frame received within 30 seconds. Backend cleanup dispatched.' },
            });
        }, INITIALIZATION_TIMEOUT_MS);

        return () => {
            clearTimeout(timeout);
            dispatchedRef.current = false;
        };
    }, [isInitializing, isTestRunning]);
}

/**
 * Compat shim — run state lives in stores/run/runStore.ts. Prefer selecting from
 * useRunStore directly; this returns a broad slice and so re-renders on most
 * run-state changes. The per-second timer fields are deliberately excluded so the
 * 1 Hz tick never reaches this subscriber; read them via SessionTimerLive.
 */
export function useDashboardController() {
    useRunSession();

    const state = useRunStore(
        useShallow((s) => ({
            isConnected: s.isConnected,
            isLaunching: s.isLaunching,
            isTestRunning: s.isTestRunning,
            isThinking: s.isThinking,
            status: s.status,
            hasRunCompleted: s.hasRunCompleted,
            terminationOutcome: s.terminationOutcome,
            hasTimeLimitExceeded: s.hasTimeLimitExceeded,
            currentEngineAction: s.currentEngineAction,
            isInitializing: s.isInitializing,
            isCleaningUp: s.isCleaningUp,
            liveFrame: s.liveFrame,
            telemetry: s.telemetry,
            networkEvents: s.networkEvents,
            accessibilityCount: s.accessibilityCount,
            accessibilityBannerDismissed: s.accessibilityBannerDismissed,
            reports: s.reports,
            incidents: s.incidents,
            latestFrame: s.latestFrame,
            currentUrl: s.currentUrl,
            sessionHistory: s.sessionHistory,
            isSavingSession: s.isSavingSession,
            isSessionSaved: s.isSessionSaved,
            browserConsole: s.browserConsole,
            isReconnecting: s.isReconnecting,
            reconnectAttempt: s.reconnectAttempt,
            isRestoring: s.isRestoring,
            isQueued: s.isQueued,
            queuePosition: s.queuePosition,
            queueDepth: s.queueDepth,
        })),
    );

    useInitializationWatchdog(state.isInitializing, state.isTestRunning);

    const actions = useMemo(() => ({
        handleTimeLimitExceeded: useRunStore.getState().handleTimeLimitExceeded,
        dismissAccessibilityBanner: useRunStore.getState().dismissAccessibilityBanner,
        startTest: startRun,
        pauseTest: pauseRun,
        resumeTest: resumeRun,
        stopTest: stopRun,
        saveSession: saveRun,
        refreshHistory,
    }), []);

    return { state, ...actions };
}

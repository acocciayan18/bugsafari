import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../stores/authStore';
import { useRunStore } from '../../stores/run/runStore';
import { initRunTimer } from '../../stores/run/runTimer';
import { bindGatewayToRunStore, connectAndRestore } from '../../stores/run/gatewayBinding';
import { startRun, pauseRun, resumeRun, stopRun, saveRun, refreshHistory } from '../../stores/run/runCommands';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import { logger } from '../../utils/logger';

import type { TestSessionStatus } from '../../stores/run/types';

export type { TestSessionStatus } from '../../stores/run/types';
export type { RunState as DashboardState } from '../../stores/run/runStore';

const INITIALIZATION_TIMEOUT_MS = 30000;
// Idempotent re-delivery cadence for a stalled PAUSING/STOPPING transition. The
// backend guards duplicate pause/stop, so a re-issued command is a safe keep-alive
// against a control emit dropped on a flaky socket — never an escalation.
const TRANSITION_REDELIVER_MS = 15000;

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
//
// The arming condition MUST mirror what LiveFeed uses to show its spinner. When
// it keyed on isInitializing alone, any backend EXCEPTION cleared that flag and
// disarmed the watchdog while the spinner — which also checks !liveFrame — kept
// running forever with nothing left to time it out.
function useInitializationWatchdog(
    isInitializing: boolean,
    isTestRunning: boolean,
    hasLiveFrame: boolean,
    status: TestSessionStatus,
): void {
    const dispatchedRef = useRef(false);
    // A queued job has no engine yet; its wait is bounded by the queue, not by us.
    const armed = isTestRunning && status !== 'QUEUED' && (isInitializing || !hasLiveFrame);

    useEffect(() => {
        if (!armed) {
            dispatchedRef.current = false;
            return;
        }

        const timeout = setTimeout(async () => {
            if (dispatchedRef.current) return;
            dispatchedRef.current = true;

            logger.warn('[useDashboardController] Initialization timeout reached - dispatching cleanup to backend');
            useRunStore.getState().setCleaningUp(true);

            try {
                const gateway = getEngineGateway() as unknown as { forceStop?: () => Promise<void> };
                if (typeof gateway.forceStop === 'function') {
                    await gateway.forceStop();
                    logger.debug('[useDashboardController] Cleanup dispatched to backend');
                }
            } catch (error) {
                logger.error('[useDashboardController] Cleanup dispatch failed:', error);
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
    }, [armed]);
}

// PAUSING and STOPPING are settled by the engine's own telemetry — engine-paused,
// or engine-stopped→IDLE, applied through ingestTelemetry — so a slow transition is
// progress, not a failure. This guards only the one way a transition stalls: a
// control emit dropped on a flaky socket. It re-delivers the SAME command on an
// interval until the engine leaves the transitional state. Pause re-delivers PAUSE
// and Stop re-delivers STOP — the two never cross, so a slow pause can never become a
// stop — and neither raises an error: the engine WILL reach a terminal state (its
// run() finally always emits IDLE). Genuine unrecoverability is a lost connection,
// which ConnectionStatusChip surfaces with a reload prompt, not a transition timer.
function useTransitionRedelivery(status: TestSessionStatus): void {
    useEffect(() => {
        if (status !== 'PAUSING' && status !== 'STOPPING') return;

        const gateway = getEngineGateway();
        // Stop re-delivers via forceStop (socket with HTTP fallback) so it survives a
        // dropped socket; pause is socket-only, matching its backend control channel.
        const redeliver = status === 'PAUSING'
            ? () => gateway.pauseTest()
            : () => void gateway.forceStop().catch((error) => logger.error('[useDashboardController] Stop re-delivery failed:', error));

        const interval = setInterval(() => {
            // Re-deliver only while still stuck in the very same transition.
            if (useRunStore.getState().status !== status) return;
            logger.warn(`[useDashboardController] ${status} still settling — re-delivering ${status === 'PAUSING' ? 'pause' : 'stop'}.`);
            redeliver();
        }, TRANSITION_REDELIVER_MS);

        return () => clearInterval(interval);
    }, [status]);
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
            reconnectGaveUp: s.reconnectGaveUp,
            isRestoring: s.isRestoring,
            isQueued: s.isQueued,
            queuePosition: s.queuePosition,
            queueDepth: s.queueDepth,
        })),
    );

    useInitializationWatchdog(state.isInitializing, state.isTestRunning, state.liveFrame !== null, state.status);
    useTransitionRedelivery(state.status);

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

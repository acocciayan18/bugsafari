import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, selectIsAuthenticated } from '../../stores/authStore';
import { useRunStore } from '../../stores/run/runStore';
import { initRunTimer } from '../../stores/run/runTimer';
import { bindGatewayToRunStore, connectAndRestore } from '../../stores/run/gatewayBinding';
import { identityKey, isIdentitySwitch } from '../../stores/run/sessionBootstrap';
import { startRun, pauseRun, resumeRun, stopRun, saveRun, refreshHistory } from '../../stores/run/runCommands';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import { classifyProbe, decideProbeAction, nextMissCount } from '../../stores/run/engineLiveness';
import { logger } from '../../utils/logger';

import type { TestSessionStatus } from '../../stores/run/types';

export type { TestSessionStatus } from '../../stores/run/types';
export type { RunState as DashboardState } from '../../stores/run/runStore';

// How long a frameless run is left alone before the client starts asking the
// backend about it, and how often it asks after that. Neither bounds the boot —
// they only set how quickly the dashboard reconciles with the backend's truth.
const LIVENESS_PROBE_GRACE_MS = 15000;
const LIVENESS_PROBE_INTERVAL_MS = 10000;
// Idempotent re-delivery cadence for a stalled PAUSING/STOPPING transition. The
// backend guards duplicate pause/stop, so a re-issued command is a safe keep-alive
// against a control emit dropped on a flaky socket — never an escalation.
const TRANSITION_REDELIVER_MS = 15000;

// Ref-counted so StrictMode's synthetic unmount never disconnects a live socket
let mountCount = 0;
let bound = false;
// Module-scoped alongside `bound`: the effect instance that binds is not
// necessarily the one whose cleanup tears down (StrictMode remounts), so the
// unsubscribe cannot live in an effect closure or it leaks.
let unsubscribeAuth: (() => void) | null = null;

// ONE effect owns the whole session bootstrap. It used to be two, and React runs
// them in declaration order — so the connect/restore effect fired its first
// protected request before the auth effect had handed the token to the HTTP
// client, and that request went out bare (the startup 401). Keeping the token
// install and the requests in a single ordered sequence removes the race by
// construction rather than by timing.
function useRunSession(): void {
    useEffect(() => {
        mountCount += 1;
        const gateway = getEngineGateway();

        if (!bound) {
            bound = true;
            initRunTimer();
            bindGatewayToRunStore(gateway);

            const auth = useAuthStore.getState();
            connectAndRestore(gateway, {
                authToken: auth.token,
                isAuthenticated: selectIsAuthenticated(auth),
            });

            // Keep the singleton's token current for the rest of the session
            // (rotation, login in another tab, logout).
            let identity = identityKey(auth.user, auth.isGuestMode);
            unsubscribeAuth = useAuthStore.subscribe((state, prev) => {
                if (state.token !== prev.token) gateway.setAuthToken(state.token);

                // An identity switch (login, logout, account swap) invalidates every
                // run-scoped thing this page holds. setAuthToken alone only reaches the
                // HTTP client — the socket's auth callback is read once per handshake,
                // so without a reconnect the wire keeps presenting the OLD account's
                // JWT, and the store keeps showing the old account's telemetry.
                const nextIdentity = identityKey(state.user, state.isGuestMode);
                if (!isIdentitySwitch(identity, nextIdentity)) return;
                identity = nextIdentity;
                console.log('[Dashboard] Operator identity changed — clearing run state and re-handshaking.');
                useRunStore.getState().resetForIdentityChange();
                gateway.reconnect();
            });
        }

        return () => {
            mountCount -= 1;
            // Only the last unmount tears down; otherwise navigating between routes
            // would deafen the socket for the rest of the session.
            if (mountCount > 0) return;
            bound = false;
            unsubscribeAuth?.();
            unsubscribeAuth = null;
            gateway.disconnect();
            gateway.removeAllListeners();
        };
    }, []);
}

/**
 * Liveness probe for a run that is up but has not painted its first frame yet.
 *
 * The frontend has no way to tell a slow boot from a dead engine: a cold
 * container plus Playwright's own 30s launch race (and its untimed fallback)
 * routinely pushes the first frame well past any client-side budget, and a queued
 * run adds worker pickup on top. The previous watchdog assumed failure on a flat
 * 30s timer and force-stopped the backend — which is why a perfectly healthy run
 * was reported as failed and then reappeared, still running, after a refresh.
 *
 * So the client never decides. Once the wait looks long it ASKS the backend, on
 * an interval, and reconciles with whatever it answers:
 *   live     → hydrate and keep waiting (this is the boot path; never a failure)
 *   terminal → hydrate; the backend really did end the run, and its snapshot says how
 *   absent   → only after MISSES_BEFORE_RELEASE consecutive misses, release the UI
 *
 * Nothing here stops the engine. A live run is left alone, and an absent one has
 * nothing left to stop. The backend owns every terminal verdict: the reservation
 * timer, failRun, the queue's failed state, and the IDLE its run() finally always
 * emits. The arming condition mirrors LiveFeed's spinner, so the probe covers
 * exactly the window in which the operator is staring at a loading feed.
 */
function useEngineLivenessProbe(
    isInitializing: boolean,
    isTestRunning: boolean,
    hasLiveFrame: boolean,
    status: TestSessionStatus,
): void {
    // Arm through QUEUED too. Excluding it is what stranded the UI in "Queuing" when a
    // queue 'active' push was lost (Redis blip / dropped frame): the worker ran on while
    // the dashboard never learned it started, and only a refresh recovered it. The probe
    // reconciles a stale QUEUED against the backend's real status, exactly as a refresh
    // does — a genuine wait returns a QUEUED snapshot (no drift) and is left untouched.
    const armed = isTestRunning && (isInitializing || !hasLiveFrame || status === 'QUEUED');

    useEffect(() => {
        if (!armed) return;

        let cancelled = false;
        let misses = 0;
        let timer: ReturnType<typeof setTimeout>;

        const probe = async (): Promise<void> => {
            try {
                const snapshot = await getEngineGateway().fetchActiveSession();
                if (cancelled) return;

                const outcome = classifyProbe(snapshot);
                misses = nextMissCount(outcome, misses);
                const current = useRunStore.getState();
                const action = decideProbeAction(outcome, misses, {
                    status: current.status,
                    hasLiveFrame: current.liveFrame !== null,
                });

                if (action === 'hydrate' && outcome.kind !== 'absent') {
                    // Restores the live feed, telemetry, timer baseline and controls in
                    // one authoritative write — the same path a refresh takes.
                    useRunStore.getState().hydrateFromSnapshot(outcome.snapshot);
                    logger.debug(`[useDashboardController] Liveness probe: backend reports ${outcome.snapshot.status}`);
                } else if (action === 'release') {
                    logger.warn('[useDashboardController] Liveness probe: backend owns no run for this client — releasing local state.');
                    useRunStore.getState().releaseOrphanedRun(
                        'Session ended. There is no active run to resume, and nothing was left running.',
                    );
                    return;
                }
            } catch (error) {
                // A failed probe proves nothing about the engine — keep waiting.
                if (cancelled) return;
                logger.error('[useDashboardController] Liveness probe failed:', error);
            }
            if (!cancelled) timer = setTimeout(() => void probe(), LIVENESS_PROBE_INTERVAL_MS);
        };

        timer = setTimeout(() => void probe(), LIVENESS_PROBE_GRACE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
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
            terminationReason: s.terminationReason,
            hasTimeLimitExceeded: s.hasTimeLimitExceeded,
            currentEngineAction: s.currentEngineAction,
            isInitializing: s.isInitializing,
            // Only the presence flag lives in this broad slice — the frame string
            // itself is consumed by LiveFeedConnected's isolated subscription, so a
            // ~30 fps frame stream never re-renders the whole dashboard. This boolean
            // flips at most twice per run (first frame, terminal).
            hasLiveFrame: s.liveFrame !== null,
            telemetry: s.telemetry,
            networkEvents: s.networkEvents,
            accessibilityCount: s.accessibilityCount,
            accessibilityBannerDismissed: s.accessibilityBannerDismissed,
            reports: s.reports,
            incidents: s.incidents,
            targetUrl: s.targetUrl,
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

    useEngineLivenessProbe(state.isInitializing, state.isTestRunning, state.hasLiveFrame, state.status);
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

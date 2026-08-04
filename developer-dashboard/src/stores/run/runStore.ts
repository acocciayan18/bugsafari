import { create } from 'zustand';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import type { BrowserConsoleMessage } from '../../application/ports/EngineGateway';
import type {
    ActiveSessionSnapshot,
    ForensicCrashReport,
    IncidentReport,
    ReproductionVerdict,
    SessionHistoryEntry,
    TelemetryEvent,
} from '../../types';
import { defaultOptimizationSettings, isCleanTermination } from '../../../../shared/types.js';
import type { RunTerminationOutcome } from '../../../../shared/types.js';
import { normalizeTargetUrl } from '../../../../shared/url.js';
import { collapseFaultIntoBuffer } from '../../utils/errorDeduplication';
import { logger } from '../../utils/logger';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import {
    CONSOLE_BUFFER_CAP,
    TELEMETRY_CAP,
    NETWORK_CAP,
    RUN_ID_STORAGE_KEY,
    RUN_CODE_STORAGE_KEY,
    RUN_SCOPED_STORAGE_KEYS,
    JOB_ID_STORAGE_KEY,
    STATUS_TOAST_ID,
    ENGINE_TERMINAL_ACTIONS,
    ENGINE_PAUSE_ACTIONS,
    ENGINE_RESUME_ACTIONS,
    ENGINE_PAUSING_ACTIONS,
    ENGINE_STOPPING_ACTIONS,
    lifecycleToStatus,
    lifecycleIsLive,
    resolveStatus,
    type TestSessionStatus,
    type QueueUpdate,
} from './types';

// Non-reactive run bookkeeping. Kept off store state so the 1 Hz tick never
// notifies subscribers for values nothing renders.
export const runRefs = {
    runStarted: false,
    runStartWallClock: 0,
    // Authoritative timebox clock, streamed by the engine. The frontend timer is a
    // display slaved to this — no independent countdown. serverElapsedMs is the last
    // engine-reported active elapsed; serverElapsedAt is the client wall-clock when it
    // landed; timeSyncSeeded gates interpolation so boot/queue time is never counted
    // (the display stays frozen at full timebox until the engine's clock actually starts).
    serverElapsedMs: 0,
    serverElapsedAt: 0,
    timeSyncSeeded: false,
    queuePhase: 'idle' as 'idle' | 'waiting' | 'active' | 'done',
    cancelInFlight: false,
    // Synchronous latch across the startTest POST window: two same-tick triggers
    // (double-click, Enter+click) both pass the state-derived UI gate before runId
    // is set, so without this both POST and spawn duplicate backend runs.
    startInFlight: false,
};

function writeStorage(key: string, value: string | null): void {
    try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        // Storage unavailable — non-fatal
    }
}

// Drop every run-scoped token at once. Leaving any one behind is what lets a
// later launch/save/attach address a run this client no longer owns — the runCode
// especially, since the save endpoint keys the persisted document on it.
function clearRunTokens(): void {
    getEngineGateway().setRunId(null);
    for (const key of RUN_SCOPED_STORAGE_KEYS) writeStorage(key, null);
}

function appendCapped<T>(previous: T[], item: T, cap: number): T[] {
    const next = [...previous, item];
    return next.length > cap ? next.slice(next.length - cap) : next;
}

function exceptionEvent(message: string, meta: Record<string, unknown> = {}): TelemetryEvent {
    return { timestamp: new Date().toISOString(), type: 'EXCEPTION', meta: { message, ...meta } };
}

export interface RunState {
    isConnected: boolean;
    isLaunching: boolean;
    isTestRunning: boolean;
    isThinking: boolean;
    status: TestSessionStatus;
    hasRunCompleted: boolean;
    terminationOutcome: RunTerminationOutcome | null;
    hasTimeLimitExceeded: boolean;
    currentEngineAction: string;
    isInitializing: boolean;
    liveFrame: string | null;
    latestFrame: string | null;
    remainingTimeMs: number;
    elapsedTimeMs: number;
    activeTimeboxMs: number;
    telemetry: TelemetryEvent[];
    networkEvents: TelemetryEvent[];
    accessibilityCount: number;
    accessibilityBannerDismissed: boolean;
    reports: ForensicCrashReport[];
    incidents: IncidentReport[];
    currentUrl: string;
    sessionHistory: SessionHistoryEntry[];
    isSavingSession: boolean;
    isSessionSaved: boolean;
    browserConsole: BrowserConsoleMessage[];
    isReconnecting: boolean;
    reconnectAttempt: number;
    // Socket.IO exhausted its reconnection budget — terminal, needs a manual reload.
    reconnectGaveUp: boolean;
    isRestoring: boolean;
    isQueued: boolean;
    queuePosition: number | null;
    queueDepth: number;
    // Fleet occupancy shown alongside the place in line, so a waiting operator can
    // see progress even while their own position is unchanged.
    queueActiveCount: number;
    queueWorkerCount: number | null;

    setConnected: (connected: boolean) => void;
    setReconnecting: (attempt: number) => void;
    setReconnectFailed: () => void;
    setRestoring: (restoring: boolean) => void;
    setCurrentUrl: (url: string) => void;
    setLiveFrame: (frame: string) => void;
    setSessionHistory: (history: SessionHistoryEntry[]) => void;
    pushTelemetry: (event: TelemetryEvent) => void;
    incrementAccessibility: () => void;
    dismissAccessibilityBanner: () => void;
    addReport: (report: ForensicCrashReport) => void;
    addIncident: (incident: IncidentReport) => void;
    applyReproductionVerdict: (verdict: ReproductionVerdict) => void;
    appendConsole: (message: BrowserConsoleMessage) => void;
    appendConsoleBatch: (messages: BrowserConsoleMessage[]) => void;
    ingestTelemetry: (event: TelemetryEvent) => void;
    applyQueueUpdate: (update: QueueUpdate) => void;
    hydrateFromSnapshot: (snapshot: ActiveSessionSnapshot) => void;
    handleTimeLimitExceeded: () => void;
    tick: (remainingTimeMs: number, elapsedTimeMs: number) => void;
    applyTimeSync: (elapsedActiveMs: number, timeboxMs: number) => void;
    resetForLaunch: (timeboxMs: number, resolvedUrl: string) => void;
    resetAfterCancel: () => void;
    /** Wipe all run-scoped state + tokens because the operator identity changed. */
    resetForIdentityChange: () => void;
    markLaunchFailed: (message: string) => void;
    releaseOrphanedRun: (message: string) => void;
    setSavingSession: (saving: boolean) => void;
    markSessionSaved: () => void;
}

const INITIAL_TIMEBOX_MS = defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;

export const useRunStore = create<RunState>((set, get) => ({
    isConnected: false,
    isLaunching: false,
    isTestRunning: false,
    isThinking: false,
    status: 'IDLE',
    hasRunCompleted: false,
    terminationOutcome: null,
    hasTimeLimitExceeded: false,
    currentEngineAction: '',
    isInitializing: false,
    liveFrame: null,
    latestFrame: null,
    remainingTimeMs: INITIAL_TIMEBOX_MS,
    elapsedTimeMs: 0,
    activeTimeboxMs: INITIAL_TIMEBOX_MS,
    telemetry: [],
    networkEvents: [],
    accessibilityCount: 0,
    accessibilityBannerDismissed: false,
    reports: [],
    incidents: [],
    currentUrl: '',
    sessionHistory: [],
    isSavingSession: false,
    isSessionSaved: false,
    browserConsole: [],
    isReconnecting: false,
    reconnectAttempt: 0,
    reconnectGaveUp: false,
    isRestoring: false,
    isQueued: false,
    queuePosition: null,
    queueDepth: 0,
    queueActiveCount: 0,
    queueWorkerCount: null,

    setConnected: (connected) =>
        set(connected
            ? { isConnected: true, isReconnecting: false, reconnectAttempt: 0, reconnectGaveUp: false }
            : { isConnected: false, isThinking: false }),

    setReconnecting: (attempt) => set({ isReconnecting: true, reconnectAttempt: attempt, reconnectGaveUp: false }),
    // Reconnection budget exhausted — clear the retry spinner and latch the terminal state.
    setReconnectFailed: () => set({ isReconnecting: false, isConnected: false, reconnectGaveUp: true }),
    setRestoring: (isRestoring) => set({ isRestoring }),
    setCurrentUrl: (currentUrl) => set({ currentUrl }),
    setSessionHistory: (sessionHistory) => set({ sessionHistory }),
    setSavingSession: (isSavingSession) => set({ isSavingSession }),
    markSessionSaved: () => set({ isSessionSaved: true }),
    dismissAccessibilityBanner: () => set({ accessibilityBannerDismissed: true }),
    incrementAccessibility: () => set((s) => ({ accessibilityCount: s.accessibilityCount + 1 })),
    addReport: (report) => set((s) => ({ reports: collapseFaultIntoBuffer(s.reports, report) })),
    addIncident: (incident) => set((s) => ({ incidents: collapseFaultIntoBuffer(s.incidents, incident) })),

    // A reproduction verdict lands seconds after its finding — patch that card's
    // verification in place rather than appending a second one.
    applyReproductionVerdict: (verdict) => set((s) => ({
        incidents: s.incidents.map((incident) =>
            incident.bugId === verdict.bugId && incident.attribution
                ? {
                    ...incident,
                    attribution: {
                        ...incident.attribution,
                        confidenceScore: verdict.confidenceScore,
                        verificationStatus: verdict.verificationStatus,
                    },
                }
                : incident,
        ),
    })),
    appendConsole: (message) => set((s) => ({ browserConsole: appendCapped(s.browserConsole, message, CONSOLE_BUFFER_CAP) })),
    // Throttled ingestion flushes a window of console messages in one commit.
    appendConsoleBatch: (messages) => {
        if (messages.length === 0) return;
        set((s) => ({ browserConsole: [...s.browserConsole, ...messages].slice(-CONSOLE_BUFFER_CAP) }));
    },
    pushTelemetry: (event) => set((s) => ({ telemetry: appendCapped(s.telemetry, event, TELEMETRY_CAP) })),

    setLiveFrame: (frame) => {
        const dataUrl = `data:image/jpeg;base64,${frame}`;
        // First frame is the authoritative "engine is running" signal for in-process
        // runs (which get no queue 'active' push) — promote STARTING→ACTIVE here.
        set((s) => ({
            liveFrame: dataUrl, latestFrame: dataUrl, isThinking: false, isInitializing: false,
            status: s.status === 'STARTING' ? 'ACTIVE' : s.status,
        }));
    },

    tick: (remainingTimeMs, elapsedTimeMs) => set({ remainingTimeMs, elapsedTimeMs }),

    // Authoritative clock landed — reset the interpolation baseline and correct the
    // display immediately (snaps a paused/frozen timer to the exact engine elapsed).
    applyTimeSync: (elapsedActiveMs, timeboxMs) => {
        runRefs.serverElapsedMs = elapsedActiveMs;
        runRefs.serverElapsedAt = Date.now();
        runRefs.timeSyncSeeded = true;
        set({
            activeTimeboxMs: timeboxMs,
            elapsedTimeMs: elapsedActiveMs,
            remainingTimeMs: Math.max(0, timeboxMs - elapsedActiveMs),
        });
    },

    handleTimeLimitExceeded: () =>
        set({ hasTimeLimitExceeded: true, isTestRunning: false, status: 'FINISHED', hasRunCompleted: true }),

    // One set per engine signal — the terminal branch previously ran 7 setters in a row.
    ingestTelemetry: (event) => {
        if (event.type === 'NETWORK') {
            set((s) => ({ networkEvents: appendCapped(s.networkEvents, event, NETWORK_CAP) }));
            return;
        }

        const patch: Partial<RunState> = {
            telemetry: appendCapped(get().telemetry, event, TELEMETRY_CAP),
        };

        // A backend EXCEPTION during init means no live frame will ever arrive, so the
        // 30s no-frame watchdog must not fire on top of an already-surfaced error.
        if (event.type === 'EXCEPTION') patch.isInitializing = false;

        const action = event.meta.actionExecuted;

        // Terminal on ANY signal — gating on type === 'ACTION' used to hide Save History
        // for every non-clean finish, which is the common case.
        if (action && ENGINE_TERMINAL_ACTIONS.has(action)) {
            const outcome = event.meta.terminationOutcome ?? null;
            if (outcome) patch.terminationOutcome = outcome;
            patch.status = outcome
                ? (isCleanTermination(outcome) && outcome !== 'user-stopped' ? 'FINISHED' : 'STOPPED')
                : action === 'engine-finished' ? 'FINISHED' : 'STOPPED';
            patch.isTestRunning = false;
            patch.hasRunCompleted = true;
            patch.liveFrame = null;
            patch.isInitializing = false;
            // Freeze the timer at its true final value (≈0 on a timebox finish) so the
            // terminal state matches the engine — no snap back to the full timebox.
            patch.remainingTimeMs = Math.max(0, get().activeTimeboxMs - get().elapsedTimeMs);
            // elapsedTimeMs is preserved so it can ride along in the manual save payload
        }

        if (event.type === 'ACTION' && action) {
            // Guard transitional writes through the state machine so an out-of-order
            // engine signal can never drive an invalid transition.
            const cur = get().status;
            if (ENGINE_PAUSING_ACTIONS.has(action)) patch.status = resolveStatus(cur, 'PAUSING');
            if (ENGINE_PAUSE_ACTIONS.has(action)) patch.status = resolveStatus(cur, 'PAUSED');
            if (ENGINE_STOPPING_ACTIONS.has(action)) patch.status = resolveStatus(cur, 'STOPPING');
            if (ENGINE_RESUME_ACTIONS.has(action)) patch.status = resolveStatus(cur, 'ACTIVE');
            if (action === 'url-changed' && event.meta.message) patch.currentUrl = event.meta.message;
            if (action === 'system-status' && event.meta.message) patch.currentEngineAction = event.meta.message;

            if (action === 'engine-status' && event.meta.message === 'IDLE') {
                logger.debug('[runStore] Received explicit IDLE status - resetting all button states');
                Object.assign(patch, {
                    isTestRunning: false,
                    isLaunching: false,
                    isThinking: false,
                    isInitializing: false,
                    isQueued: false,
                    queuePosition: null,
                    status: 'IDLE' as TestSessionStatus,
                    liveFrame: null,
                    isReconnecting: false,
                });
                // Run settled — no queue message may outlive it
                runRefs.queuePhase = 'done';
                toast.dismiss(STATUS_TOAST_ID);
                getEngineGateway().setRunId(null);
                writeStorage(RUN_ID_STORAGE_KEY, null);
                writeStorage(JOB_ID_STORAGE_KEY, null);
                // The backend always emits IDLE in its finally block, even on a fatal
                // crash that sent no terminal action — so Save History stays available.
                if (runRefs.runStarted) patch.hasRunCompleted = true;
            }
        }

        set(patch);
    },

    // BullMQ's forward-only job state is the single source of truth for activation.
    applyQueueUpdate: (update) => {
        if (update.state === 'waiting') {
            // Out-of-order guard: a stale position racing in after the worker picked the
            // job up must not resurrect queued state.
            if (runRefs.queuePhase === 'active' || runRefs.queuePhase === 'done') return;
            // State-machine guard: never regress a run that already reached ACTIVE.
            if (resolveStatus(get().status, 'QUEUED') !== 'QUEUED') return;
            runRefs.queuePhase = 'waiting';
            set({
                isQueued: true,
                queuePosition: update.position,
                queueDepth: update.queueDepth,
                queueActiveCount: update.activeCount ?? 0,
                queueWorkerCount: update.workerCount ?? null,
                isTestRunning: true,
                status: 'QUEUED',
                isInitializing: false,
            });
            // Shared id makes repeated waiting pushes update in place instead of stacking.
            // The live place in line rides the chip, not the toast — a toast body that
            // changes every push re-announces itself to screen readers on each tick.
            toast('Session queued. Waiting for an available worker, then execution starts automatically.', { id: STATUS_TOAST_ID, duration: Infinity });
            return;
        }

        if (update.state === 'active') {
            runRefs.queuePhase = 'active';
            toast.dismiss(STATUS_TOAST_ID);
            // Anchor the countdown to when execution actually begins, so queued wait
            // time is never counted as run time.
            runRefs.runStartWallClock = Date.now();
            // Engine hasn't booted yet — leave the clock unseeded so the display stays
            // at full timebox until the engine streams its first authoritative sync.
            runRefs.serverElapsedMs = 0;
            runRefs.serverElapsedAt = Date.now();
            runRefs.timeSyncSeeded = false;
            set({ isQueued: false, queuePosition: null, status: resolveStatus(get().status, 'ACTIVE'), isInitializing: true });
            return;
        }

        runRefs.queuePhase = 'done';
        toast.dismiss(STATUS_TOAST_ID);
        writeStorage(JOB_ID_STORAGE_KEY, null);

        if (update.state === 'cancelled') {
            // No worker ever ran it, so no engine telemetry will arrive to reset the UI
            runRefs.runStarted = false;
            set({
                isQueued: false, queuePosition: null, queueDepth: 0, isInitializing: false,
                isThinking: false, isLaunching: false, isTestRunning: false, status: 'IDLE',
            });
            return;
        }

        if (update.state === 'failed') {
            console.error('[runStore] Queued run failed before execution:', update.message ?? 'unknown error');
            const message = "Your queued run couldn't start. Try again.";
            toast.error(message);
            set((s) => ({
                isQueued: false, queuePosition: null, isInitializing: false, isThinking: false,
                isLaunching: false, isTestRunning: false, status: 'IDLE',
                telemetry: appendCapped(s.telemetry, exceptionEvent(message), TELEMETRY_CAP),
            }));
            return;
        }

        set({ isQueued: false, queuePosition: null });
    },

    // Restore-on-load and reconnect replay both funnel here; the snapshot is
    // authoritative for the buffered window, so we replace rather than merge.
    hydrateFromSnapshot: (snapshot) => {
        const gateway = getEngineGateway();
        const live = lifecycleIsLive(snapshot.status);
        const queued = snapshot.status === 'QUEUED';
        const snapshotRemaining = Math.max(0, snapshot.timeboxMs - snapshot.elapsedTimeMs);

        runRefs.runStarted = true;
        // Re-seed the authoritative baseline from the snapshot's engine elapsed; the
        // next time-sync corrects within ~1s. Interpolate only for a live run.
        runRefs.serverElapsedMs = snapshot.elapsedTimeMs;
        runRefs.serverElapsedAt = Date.now();
        runRefs.timeSyncSeeded = live;
        runRefs.queuePhase = queued ? 'waiting' : live ? 'active' : 'done';
        if (!queued) toast.dismiss(STATUS_TOAST_ID);

        const frame = snapshot.lastFrame ? `data:image/jpeg;base64,${snapshot.lastFrame}` : null;

        set({
            telemetry: snapshot.telemetry.filter((e) => e.type !== 'NETWORK').slice(-TELEMETRY_CAP),
            networkEvents: snapshot.telemetry.filter((e) => e.type === 'NETWORK').slice(-NETWORK_CAP),
            accessibilityCount: (snapshot.accessibility ?? []).length,
            // Buffers arrive oldest→newest; fold through the same collapse so a restored
            // session holds one entry per fault (newest-first) with counts.
            reports: snapshot.reports.reduce<ForensicCrashReport[]>((buf, r) => collapseFaultIntoBuffer(buf, r), []),
            incidents: snapshot.incidents.reduce<IncidentReport[]>((buf, i) => collapseFaultIntoBuffer(buf, i), []),
            browserConsole: (snapshot.browserConsole ?? []).slice(-CONSOLE_BUFFER_CAP),
            currentUrl: normalizeTargetUrl(snapshot.currentUrl || snapshot.targetUrl) ?? snapshot.targetUrl,
            activeTimeboxMs: snapshot.timeboxMs,
            elapsedTimeMs: snapshot.elapsedTimeMs,
            remainingTimeMs: snapshotRemaining,
            status: lifecycleToStatus(snapshot.status),
            isTestRunning: live,
            hasRunCompleted: !live,
            // The snapshot field is authoritative — the telemetry buffer is capped and
            // can evict the terminal event on a long run.
            terminationOutcome: live ? null : snapshot.terminationOutcome,
            isLaunching: false,
            isQueued: queued,
            queuePosition: queued ? snapshot.queuePosition ?? null : null,
            queueDepth: queued ? snapshot.queueDepth ?? 0 : 0,
            queueActiveCount: queued ? snapshot.queueActiveCount ?? 0 : 0,
            queueWorkerCount: queued ? snapshot.queueWorkerCount ?? null : null,
            // Deterministic init flag, derived from the snapshot rather than left as
            // whatever the local state happened to hold: a frame means the feed is up,
            // a live-but-frameless run is still booting, and queued/terminal is not.
            ...(frame
                ? { liveFrame: frame, latestFrame: frame, isInitializing: false, isThinking: false }
                : { isInitializing: live && !queued, isThinking: false }),
        });

        if (snapshot.jobId && live) {
            gateway.restoreQueueSubscription(snapshot.jobId, snapshot.runToken);
            writeStorage(JOB_ID_STORAGE_KEY, snapshot.jobId);
        }

        // Reattach proves ownership with the opaque runToken, never the display runId code
        gateway.setRunId(snapshot.runToken);
        writeStorage(RUN_ID_STORAGE_KEY, snapshot.runToken);
        // Restore the run's public code too, so a save after a refresh still rewrites
        // this run's document instead of creating a second one.
        writeStorage(RUN_CODE_STORAGE_KEY, snapshot.runId || null);
    },

    resetForLaunch: (timeboxMs, resolvedUrl) => {
        runRefs.runStarted = true;
        runRefs.runStartWallClock = Date.now();
        // Unseeded until the engine streams its first sync — display holds full timebox
        // through boot instead of counting it.
        runRefs.serverElapsedMs = 0;
        runRefs.serverElapsedAt = Date.now();
        runRefs.timeSyncSeeded = false;
        // Fresh submission opens a new queue lifecycle for the phase guard
        runRefs.queuePhase = 'idle';
        toast.dismiss(STATUS_TOAST_ID);

        set({
            activeTimeboxMs: timeboxMs,
            isThinking: true,
            isLaunching: true,
            isTestRunning: true,
            // Neutral launch state — server promotes it to QUEUED or ACTIVE. No
            // optimistic ACTIVE, so there is no ACTIVE→QUEUED→ACTIVE flicker.
            status: 'STARTING',
            isInitializing: true,
            liveFrame: null,
            telemetry: [],
            networkEvents: [],
            accessibilityCount: 0,
            accessibilityBannerDismissed: false,
            reports: [],
            incidents: [],
            // Console buffer is per-run; a new session must never inherit prior logs
            browserConsole: [],
            currentUrl: resolvedUrl,
            remainingTimeMs: timeboxMs,
            elapsedTimeMs: 0,
            hasRunCompleted: false,
            terminationOutcome: null,
            hasTimeLimitExceeded: false,
            isSessionSaved: false,
            isQueued: false,
            queuePosition: null,
            queueDepth: 0,
            // Fleet counts are per-run context; a relaunch must not show the prior
            // run's occupancy in the gap before the first queue push lands.
            queueActiveCount: 0,
            queueWorkerCount: null,
        });
    },

    // A cancelled queued run never started an engine — nothing to save or replay.
    resetAfterCancel: () => {
        runRefs.queuePhase = 'done';
        runRefs.runStarted = false;
        toast.dismiss(STATUS_TOAST_ID);
        clearRunTokens();
        set({
            isQueued: false, queuePosition: null, queueDepth: 0, isTestRunning: false,
            isLaunching: false, isInitializing: false, isThinking: false, status: 'IDLE',
        });
    },

    // The backend confirmed (repeatedly) that it owns no run for this client, so
    // the local live state is orphaned. Same teardown as a failed launch — clearing
    // the tokens matters most: leaving them behind is what desynced the dashboard
    // from a backend that had already moved on.
    releaseOrphanedRun: (message) => {
        runRefs.queuePhase = 'done';
        runRefs.runStarted = false;
        toast.dismiss(STATUS_TOAST_ID);
        clearRunTokens();
        set((s) => ({
            isInitializing: false,
            isThinking: false,
            isLaunching: false,
            isTestRunning: false,
            isQueued: false,
            queuePosition: null,
            queueDepth: 0,
            liveFrame: null,
            status: 'IDLE',
            telemetry: appendCapped(s.telemetry, exceptionEvent(message), TELEMETRY_CAP),
        }));
    },

    // The operator's identity changed (login, logout, account switch). Everything in
    // this store belongs to the PREVIOUS identity, so it is wiped rather than reset:
    // leaving the buffers would show one account another's telemetry, and leaving the
    // tokens would let the new account attach to — and save over — the old one's run.
    resetForIdentityChange: () => {
        runRefs.queuePhase = 'idle';
        runRefs.runStarted = false;
        runRefs.runStartWallClock = 0;
        runRefs.serverElapsedMs = 0;
        runRefs.serverElapsedAt = 0;
        runRefs.timeSyncSeeded = false;
        toast.dismiss(STATUS_TOAST_ID);
        clearRunTokens();
        set({
            status: 'IDLE',
            isTestRunning: false,
            isLaunching: false,
            isThinking: false,
            isInitializing: false,
            isQueued: false,
            isReconnecting: false,
            hasRunCompleted: false,
            hasTimeLimitExceeded: false,
            terminationOutcome: null,
            queuePosition: null,
            queueDepth: 0,
            queueActiveCount: 0,
            queueWorkerCount: null,
            liveFrame: null,
            latestFrame: null,
            telemetry: [],
            networkEvents: [],
            reports: [],
            incidents: [],
            browserConsole: [],
            accessibilityCount: 0,
            accessibilityBannerDismissed: false,
            // History is per-tenant and refetched for the new identity.
            sessionHistory: [],
            isSavingSession: false,
            isSessionSaved: false,
            elapsedTimeMs: 0,
        });
    },

    // A failed launch owns no run — drop the tokens too, or the next start sends a
    // stale knownRunId and the server "resumes" a session that no longer exists.
    markLaunchFailed: (message) => {
        runRefs.queuePhase = 'done';
        runRefs.runStarted = false;
        toast.dismiss(STATUS_TOAST_ID);
        clearRunTokens();
        set((s) => ({
            isInitializing: false,
            isThinking: false,
            isLaunching: false,
            isTestRunning: false,
            isQueued: false,
            queuePosition: null,
            queueDepth: 0,
            status: 'IDLE',
            telemetry: appendCapped(s.telemetry, exceptionEvent(`Launch failed: ${message}`), TELEMETRY_CAP),
        }));
    },
}));

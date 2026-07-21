import { create } from 'zustand';
import { toast } from 'sonner';
import type { BrowserConsoleMessage } from '../../application/ports/EngineGateway';
import type {
    ActiveSessionSnapshot,
    ForensicCrashReport,
    IncidentReport,
    ReproductionVerdict,
    SessionHistoryEntry,
    TelemetryEvent,
} from '../../types';
import { defaultOptimizationSettings } from '../../../../shared/types.js';
import type { RunTerminationOutcome } from '../../../../shared/types.js';
import { normalizeTargetUrl } from '../../../../shared/url.js';
import { collapseFaultIntoBuffer } from '../../utils/errorDeduplication';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import {
    CONSOLE_BUFFER_CAP,
    TELEMETRY_CAP,
    NETWORK_CAP,
    RUN_ID_STORAGE_KEY,
    JOB_ID_STORAGE_KEY,
    STATUS_TOAST_ID,
    ENGINE_TERMINAL_ACTIONS,
    ENGINE_PAUSE_ACTIONS,
    ENGINE_RESUME_ACTIONS,
    ENGINE_PAUSING_ACTIONS,
    ENGINE_STOPPING_ACTIONS,
    lifecycleToStatus,
    lifecycleIsLive,
    terminalStatusFromOutcome,
    type TestSessionStatus,
    type QueueUpdate,
} from './types';

// Non-reactive run bookkeeping. Kept off store state so the 1 Hz tick never
// notifies subscribers for values nothing renders.
export const runRefs = {
    runStarted: false,
    runStartWallClock: 0,
    runDeadline: 0,
    pausedRemaining: 0,
    queuePhase: 'idle' as 'idle' | 'waiting' | 'active' | 'done',
    cancelInFlight: false,
};

function writeStorage(key: string, value: string | null): void {
    try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        // Storage unavailable — non-fatal
    }
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
    isCleaningUp: boolean;
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
    isRestoring: boolean;
    isQueued: boolean;
    queuePosition: number | null;
    queueDepth: number;

    setConnected: (connected: boolean) => void;
    setReconnecting: (attempt: number) => void;
    setRestoring: (restoring: boolean) => void;
    setCurrentUrl: (url: string) => void;
    setLiveFrame: (frame: string) => void;
    setSessionHistory: (history: SessionHistoryEntry[]) => void;
    setCleaningUp: (cleaningUp: boolean) => void;
    pushTelemetry: (event: TelemetryEvent) => void;
    incrementAccessibility: () => void;
    dismissAccessibilityBanner: () => void;
    addReport: (report: ForensicCrashReport) => void;
    addIncident: (incident: IncidentReport) => void;
    applyReproductionVerdict: (verdict: ReproductionVerdict) => void;
    appendConsole: (message: BrowserConsoleMessage) => void;
    ingestTelemetry: (event: TelemetryEvent) => void;
    applyQueueUpdate: (update: QueueUpdate) => void;
    hydrateFromSnapshot: (snapshot: ActiveSessionSnapshot) => void;
    handleTimeLimitExceeded: () => void;
    tick: (remainingTimeMs: number, elapsedTimeMs: number) => void;
    resetForLaunch: (timeboxMs: number, resolvedUrl: string) => void;
    resetAfterCancel: () => void;
    markLaunchFailed: (message: string) => void;
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
    isCleaningUp: false,
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
    isRestoring: false,
    isQueued: false,
    queuePosition: null,
    queueDepth: 0,

    setConnected: (connected) =>
        set(connected
            ? { isConnected: true, isReconnecting: false, reconnectAttempt: 0 }
            : { isConnected: false, isThinking: false }),

    setReconnecting: (attempt) => set({ isReconnecting: true, reconnectAttempt: attempt }),
    setRestoring: (isRestoring) => set({ isRestoring }),
    setCurrentUrl: (currentUrl) => set({ currentUrl }),
    setSessionHistory: (sessionHistory) => set({ sessionHistory }),
    setCleaningUp: (isCleaningUp) => set({ isCleaningUp }),
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
    pushTelemetry: (event) => set((s) => ({ telemetry: appendCapped(s.telemetry, event, TELEMETRY_CAP) })),

    setLiveFrame: (frame) => {
        const dataUrl = `data:image/jpeg;base64,${frame}`;
        set({ liveFrame: dataUrl, latestFrame: dataUrl, isThinking: false, isInitializing: false });
    },

    tick: (remainingTimeMs, elapsedTimeMs) => set({ remainingTimeMs, elapsedTimeMs }),

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
                ? terminalStatusFromOutcome(outcome)
                : action === 'engine-finished' ? 'FINISHED' : 'STOPPED';
            patch.isTestRunning = false;
            patch.hasRunCompleted = true;
            patch.liveFrame = null;
            patch.isInitializing = false;
            patch.remainingTimeMs = get().activeTimeboxMs;
            // elapsedTimeMs is preserved so it can ride along in the manual save payload
        }

        if (event.type === 'ACTION' && action) {
            if (ENGINE_PAUSING_ACTIONS.has(action)) patch.status = 'PAUSING';
            if (ENGINE_PAUSE_ACTIONS.has(action)) patch.status = 'PAUSED';
            if (ENGINE_STOPPING_ACTIONS.has(action)) patch.status = 'STOPPING';
            if (ENGINE_RESUME_ACTIONS.has(action)) patch.status = 'ACTIVE';
            if (action === 'url-changed' && event.meta.message) patch.currentUrl = event.meta.message;
            if (action === 'system-status' && event.meta.message) patch.currentEngineAction = event.meta.message;

            if (action === 'engine-status' && event.meta.message === 'IDLE') {
                console.log('[runStore] Received explicit IDLE status - resetting all button states');
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
            runRefs.queuePhase = 'waiting';
            set({
                isQueued: true,
                queuePosition: update.position,
                queueDepth: update.queueDepth,
                isTestRunning: true,
                status: 'QUEUED',
                isInitializing: false,
            });
            // Shared id makes repeated waiting pushes update in place instead of stacking
            toast('Session queued — waiting for an available worker. Execution starts automatically.', { id: STATUS_TOAST_ID, duration: Infinity });
            return;
        }

        if (update.state === 'active') {
            runRefs.queuePhase = 'active';
            toast.dismiss(STATUS_TOAST_ID);
            // Anchor the countdown to when execution actually begins, so queued wait
            // time is never counted as run time.
            runRefs.runStartWallClock = Date.now();
            runRefs.runDeadline = Date.now() + get().activeTimeboxMs;
            runRefs.pausedRemaining = 0;
            set({ isQueued: false, queuePosition: null, status: 'ACTIVE', isInitializing: true });
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
            const message = `Queued run failed before execution: ${update.message ?? 'unknown error'}`;
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
        runRefs.runDeadline = Date.now() + snapshotRemaining;
        runRefs.pausedRemaining = 0;
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
            // Live/queued read the lifecycle directly; a terminal run derives its
            // status from the authoritative outcome so a post-stop refresh matches
            // the live STOPPED/Halted view instead of misreading COMPLETED→FINISHED.
            status: live ? lifecycleToStatus(snapshot.status) : terminalStatusFromOutcome(snapshot.terminationOutcome),
            isTestRunning: live,
            hasRunCompleted: !live,
            // The snapshot field is authoritative — the telemetry buffer is capped and
            // can evict the terminal event on a long run.
            terminationOutcome: live ? null : snapshot.terminationOutcome,
            isLaunching: false,
            isQueued: queued,
            queuePosition: queued ? snapshot.queuePosition ?? null : null,
            queueDepth: queued ? snapshot.queueDepth ?? 0 : 0,
            // Only clear the launch spinner once a frame exists — a snapshot taken at
            // run-start must not disable the 30s no-frame watchdog.
            ...(frame ? { liveFrame: frame, latestFrame: frame, isInitializing: false, isThinking: false } : {}),
        });

        if (snapshot.jobId && live) {
            gateway.restoreQueueSubscription(snapshot.jobId, snapshot.runId);
            writeStorage(JOB_ID_STORAGE_KEY, snapshot.jobId);
        }

        // Keep the run token aligned so a subsequent reconnect re-attaches
        gateway.setRunId(snapshot.runId);
        writeStorage(RUN_ID_STORAGE_KEY, snapshot.runId);
    },

    resetForLaunch: (timeboxMs, resolvedUrl) => {
        runRefs.runStarted = true;
        runRefs.runStartWallClock = Date.now();
        runRefs.runDeadline = Date.now() + timeboxMs;
        runRefs.pausedRemaining = 0;
        // Fresh submission opens a new queue lifecycle for the phase guard
        runRefs.queuePhase = 'idle';
        toast.dismiss(STATUS_TOAST_ID);

        set({
            activeTimeboxMs: timeboxMs,
            isThinking: true,
            isLaunching: true,
            isTestRunning: true,
            status: 'ACTIVE',
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
        });
    },

    // A cancelled queued run never started an engine — nothing to save or replay.
    resetAfterCancel: () => {
        runRefs.queuePhase = 'done';
        runRefs.runStarted = false;
        toast.dismiss(STATUS_TOAST_ID);
        getEngineGateway().setRunId(null);
        writeStorage(RUN_ID_STORAGE_KEY, null);
        writeStorage(JOB_ID_STORAGE_KEY, null);
        set({
            isQueued: false, queuePosition: null, queueDepth: 0, isTestRunning: false,
            isLaunching: false, isInitializing: false, isThinking: false, status: 'IDLE',
        });
    },

    // A failed launch owns no run — drop the tokens too, or the next start sends a
    // stale knownRunId and the server "resumes" a session that no longer exists.
    markLaunchFailed: (message) => {
        runRefs.queuePhase = 'done';
        runRefs.runStarted = false;
        toast.dismiss(STATUS_TOAST_ID);
        getEngineGateway().setRunId(null);
        writeStorage(RUN_ID_STORAGE_KEY, null);
        writeStorage(JOB_ID_STORAGE_KEY, null);
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

import { create } from 'zustand';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import type { BrowserConsoleMessage } from '../../application/ports/EngineGateway';
import type {
    ActiveSessionSnapshot,
    FindingOccurrencePatch,
    FindingUpgrade,
    ForensicCrashReport,
    IncidentReport,
    NetworkPhase,
    ReproductionVerdict,
    SessionHistoryEntry,
    TelemetryEvent,
} from '../../types';
import { NETWORK_ACTION } from '../../types';
import { defaultOptimizationSettings, isCleanTermination } from '../../../../shared/types.js';
import type { RunTerminationOutcome } from '../../../../shared/types.js';
import { normalizeTargetUrl } from '../../../../shared/url.js';
import { collapseFaultIntoBuffer, applyOccurrencePatchToBuffer } from '../../utils/errorDeduplication';
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
    reconcileHydratedStatus,
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
    /** Bare engine reason behind the outcome, surfaced under the terminal label. */
    terminationReason: string | null;
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
    // The original address the operator launched — fixed for the run's lifetime.
    targetUrl: string;
    // The live address the browser is on now — advances as the engine navigates.
    currentUrl: string;
    sessionHistory: SessionHistoryEntry[];
    isSavingSession: boolean;
    isSessionSaved: boolean;
    browserConsole: BrowserConsoleMessage[];
    isReconnecting: boolean;
    reconnectAttempt: number;
    // Socket.IO exhausted its reconnection budget — terminal, needs a manual reload.
    reconnectGaveUp: boolean;
    // Backend-detected reachability of the TARGET app (independent of the dashboard
    // socket). Driven by the engine's NETWORK_ACTION telemetry markers.
    targetNetworkPhase: NetworkPhase;
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
    incrementAccessibilityBy: (n: number) => void;
    dismissAccessibilityBanner: () => void;
    addReport: (report: ForensicCrashReport) => void;
    addReports: (reports: ForensicCrashReport[]) => void;
    addIncident: (incident: IncidentReport) => void;
    addIncidents: (incidents: IncidentReport[]) => void;
    applyReproductionVerdict: (verdict: ReproductionVerdict) => void;
    applyFindingUpgrade: (upgrade: FindingUpgrade) => void;
    applyFindingOccurrence: (patch: FindingOccurrencePatch) => void;
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
    terminationReason: null,
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
    targetUrl: '',
    currentUrl: '',
    sessionHistory: [],
    isSavingSession: false,
    isSessionSaved: false,
    browserConsole: [],
    isReconnecting: false,
    reconnectAttempt: 0,
    reconnectGaveUp: false,
    targetNetworkPhase: 'ONLINE',
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
    incrementAccessibilityBy: (n) => { if (n > 0) set((s) => ({ accessibilityCount: s.accessibilityCount + n })); },
    addReport: (report) => set((s) => ({ reports: collapseFaultIntoBuffer(s.reports, report) })),
    // Fold a coalesced burst through the same collapse reducer in ONE commit.
    addReports: (reports) => {
        if (reports.length === 0) return;
        set((s) => ({ reports: reports.reduce((buf, r) => collapseFaultIntoBuffer(buf, r), s.reports) }));
    },
    addIncident: (incident) => set((s) => ({ incidents: collapseFaultIntoBuffer(s.incidents, incident) })),
    addIncidents: (incidents) => {
        if (incidents.length === 0) return;
        set((s) => ({ incidents: incidents.reduce((buf, i) => collapseFaultIntoBuffer(buf, i), s.incidents) }));
    },

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
    // A later, stronger verdict (e.g. a double-submit that rose SUSPECTED → CONFIRMED once
    // its control correlated) patches the existing card in place by bugId. Re-emitting the
    // incident would append a second card, since the live buffer keys on message content.
    applyFindingUpgrade: (upgrade) => set((s) => ({
        incidents: s.incidents.map((incident) =>
            incident.bugId === upgrade.bugId
                ? {
                    ...incident,
                    severity: upgrade.severity,
                    reason: upgrade.message,
                    attribution: incident.attribution
                        ? {
                            ...incident.attribution,
                            ...(upgrade.confidence ? { confidence: upgrade.confidence } : {}),
                            ...(upgrade.confidenceScore !== undefined ? { confidenceScore: upgrade.confidenceScore } : {}),
                            ...(upgrade.verificationStatus ? { verificationStatus: upgrade.verificationStatus } : {}),
                        }
                        : incident.attribution,
                }
                : incident,
        ),
    })),
    // Authoritative repeat-count update from the engine — patch the card's ×N by bugId in
    // both buffers. Idempotent and monotonic, so a reconnect replay never inflates it.
    applyFindingOccurrence: (patch) => set((s) => ({
        incidents: applyOccurrencePatchToBuffer(s.incidents, patch.bugId, patch.occurrences),
        reports: applyOccurrencePatchToBuffer(s.reports, patch.bugId, patch.occurrences),
    })),
    appendConsole: (message) => set((s) => ({ browserConsole: appendCapped(s.browserConsole, message, CONSOLE_BUFFER_CAP) })),
    // Throttled ingestion flushes a window of console messages in one commit.
    appendConsoleBatch: (messages) => {
        if (messages.length === 0) return;
        set((s) => ({ browserConsole: [...s.browserConsole, ...messages].slice(-CONSOLE_BUFFER_CAP) }));
    },
    pushTelemetry: (event) => set((s) => ({ telemetry: appendCapped(s.telemetry, event, TELEMETRY_CAP) })),

    setLiveFrame: (frame) => {
        // Wire frames are raw base64; tolerate an already-wrapped data URL so a
        // double prefix can never produce a broken image the canvas won't paint.
        const dataUrl = frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`;
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
        // A same-run clock only advances. Once seeded, drop a stale sync that would
        // rewind elapsed under an unchanged timebox (a lagging worker frame, a late
        // pre-pause packet) — it would jump the display back toward the full box. A
        // fresh run clears timeSyncSeeded first, and a timebox change means a new
        // run/config, so both still re-baseline correctly.
        if (runRefs.timeSyncSeeded && timeboxMs === get().activeTimeboxMs && elapsedActiveMs < runRefs.serverElapsedMs) {
            return;
        }
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
            if (event.meta.terminationReason) patch.terminationReason = event.meta.terminationReason;
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

            // Target-reachability markers drive the network status chip (independent of
            // the dashboard socket): degraded = findings suppressed, paused = auto-retrying.
            if (action === NETWORK_ACTION.DEGRADED) patch.targetNetworkPhase = 'DEGRADED';
            else if (action === NETWORK_ACTION.PAUSED) patch.targetNetworkPhase = 'PAUSED_NETWORK';
            else if (action === NETWORK_ACTION.RECOVERED || action === NETWORK_ACTION.RESUMED) patch.targetNetworkPhase = 'ONLINE';

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
                    targetNetworkPhase: 'ONLINE' as NetworkPhase,
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

        // A hydrate is a RESTORE primitive. When it lands for the SAME run already
        // held locally (reconnect, liveness probe, mid-run refetch), the live socket
        // stream is fresher than this lagging, capped, frame-less snapshot — a blind
        // replace would WIPE findings/telemetry, rewind the timer, and blank the feed.
        // Reconcile non-destructively for a same run: keep the richer local buffers,
        // never move the timer backward, never blank a present live frame. A fresh
        // restore (empty local / different run) still hydrates wholesale.
        const prev = get();
        const sameRun = !!snapshot.runToken && snapshot.runToken === gateway.getRunId();

        runRefs.runStarted = true;

        // Buffers arrive oldest→newest; fold through the same collapse so a restore
        // holds one entry per fault (newest-first) with counts.
        const snapTelemetry = snapshot.telemetry.filter((e) => e.type !== 'NETWORK').slice(-TELEMETRY_CAP);
        const snapNetwork = snapshot.telemetry.filter((e) => e.type === 'NETWORK').slice(-NETWORK_CAP);
        const snapReports = snapshot.reports.reduce<ForensicCrashReport[]>((buf, r) => collapseFaultIntoBuffer(buf, r), []);
        const snapIncidents = snapshot.incidents.reduce<IncidentReport[]>((buf, i) => collapseFaultIntoBuffer(buf, i), []);
        const snapConsole = (snapshot.browserConsole ?? []).slice(-CONSOLE_BUFFER_CAP);
        const snapAccessibility = (snapshot.accessibility ?? []).length;

        // Same-run reconcile keeps whichever side carries more — never shrinks live data.
        const keepLonger = <T,>(local: T[], snap: T[]): T[] => (sameRun && local.length > snap.length ? local : snap);
        const telemetry = keepLonger(prev.telemetry, snapTelemetry);
        const networkEvents = keepLonger(prev.networkEvents, snapNetwork);
        const reports = keepLonger(prev.reports, snapReports);
        const incidents = keepLonger(prev.incidents, snapIncidents);
        const browserConsole = keepLonger(prev.browserConsole, snapConsole);
        const accessibilityCount = sameRun ? Math.max(prev.accessibilityCount, snapAccessibility) : snapAccessibility;

        // Same-run elapsed can only advance — a lagging snapshot must not rewind the clock.
        const elapsedTimeMs = sameRun ? Math.max(prev.elapsedTimeMs, snapshot.elapsedTimeMs) : snapshot.elapsedTimeMs;
        const remainingTimeMs = Math.max(0, snapshot.timeboxMs - elapsedTimeMs);

        // Re-seed the authoritative baseline; the next time-sync corrects within ~1s.
        runRefs.serverElapsedMs = elapsedTimeMs;
        runRefs.serverElapsedAt = Date.now();
        runRefs.timeSyncSeeded = live;
        runRefs.queuePhase = queued ? 'waiting' : live ? 'active' : 'done';
        if (!queued) toast.dismiss(STATUS_TOAST_ID);

        const snapshotFrame = snapshot.lastFrame
            ? (snapshot.lastFrame.startsWith('data:') ? snapshot.lastFrame : `data:image/jpeg;base64,${snapshot.lastFrame}`)
            : null;
        // The periodic registry snapshot omits the frame — a frame-less same-run LIVE
        // hydrate must keep the frame already on screen instead of blanking the feed.
        const frame = snapshotFrame ?? (sameRun && live ? prev.liveFrame : null);

        // Status is the one field a same-run hydrate must NOT blindly replace — a lagging
        // reconnect snapshot (session marked INTERRUPTED → ACTIVE on a socket drop) would
        // otherwise knock a just-issued PAUSING/PAUSED/STOPPING back to ACTIVE, the pause
        // desync seen on slow links. See reconcileHydratedStatus for the full rationale.
        const reconciledStatus = reconcileHydratedStatus(prev.status, lifecycleToStatus(snapshot.status), sameRun);

        set({
            telemetry,
            networkEvents,
            accessibilityCount,
            reports,
            incidents,
            browserConsole,
            // Original launch target, held stable for the field; currentUrl tracks navigation.
            targetUrl: normalizeTargetUrl(snapshot.targetUrl) ?? snapshot.targetUrl,
            currentUrl: normalizeTargetUrl(snapshot.currentUrl || snapshot.targetUrl) ?? snapshot.targetUrl,
            activeTimeboxMs: snapshot.timeboxMs,
            elapsedTimeMs,
            remainingTimeMs,
            status: reconciledStatus,
            isTestRunning: live,
            hasRunCompleted: !live,
            // The snapshot field is authoritative — the telemetry buffer is capped and
            // can evict the terminal event on a long run.
            terminationOutcome: live ? null : snapshot.terminationOutcome,
            terminationReason: live ? null : snapshot.terminationReason,
            isLaunching: false,
            isQueued: queued,
            queuePosition: queued ? snapshot.queuePosition ?? null : null,
            queueDepth: queued ? snapshot.queueDepth ?? 0 : 0,
            queueActiveCount: queued ? snapshot.queueActiveCount ?? 0 : 0,
            queueWorkerCount: queued ? snapshot.queueWorkerCount ?? null : null,
            // Deterministic init flag: a frame means the feed is up, a live-but-frameless
            // run is still booting, and queued/terminal is not.
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
            targetUrl: resolvedUrl,
            currentUrl: resolvedUrl,
            remainingTimeMs: timeboxMs,
            elapsedTimeMs: 0,
            hasRunCompleted: false,
            terminationOutcome: null,
            terminationReason: null,
            hasTimeLimitExceeded: false,
            isSessionSaved: false,
            // A new run starts assuming the target is reachable.
            targetNetworkPhase: 'ONLINE',
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
            terminationReason: null,
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
            targetUrl: '',
            currentUrl: '',
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

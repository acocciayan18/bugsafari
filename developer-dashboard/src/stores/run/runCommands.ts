import { toast } from '../../infrastructure/notifications/ToastProvider';
import type { OptimizationSettings, TargetAuthConfig, ExplorationRunConfig, TelemetryEvent } from '../../types';
import { defaultOptimizationSettings, isActionableNetworkStatus } from '../../../../shared/types.js';
import { normalizeTargetUrl, isPrivateTargetUrl, PUBLIC_TARGET_REQUIRED_MESSAGE } from '../../../../shared/url.js';
import { saveSessionToHistory } from '../../services/historyService';
import { buildLiveFindings } from '../../utils/findingsBuilder';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import { useRunStore, runRefs } from './runStore';
import { RUN_ID_STORAGE_KEY, RUN_CODE_STORAGE_KEY, JOB_ID_STORAGE_KEY, STATUS_TOAST_ID, resolveStatus } from './types';

function writeStorage(key: string, value: string | null): void {
    try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        // Storage unavailable
    }
}

function readStorage(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function actionEvent(message: string, actionExecuted?: string): TelemetryEvent {
    return {
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: { message, ...(actionExecuted ? { actionExecuted } : {}) },
    };
}

export async function startRun(
    targetUrl: string,
    optimizationSettings?: OptimizationSettings,
    infiltration?: ExplorationRunConfig,
    targetAuth?: TargetAuthConfig,
): Promise<void> {
    // Resolve to the exact address the engine will navigate to, so the UI never shows
    // a bare host while Playwright tests the https:// form.
    const resolvedUrl = normalizeTargetUrl(targetUrl);
    if (!resolvedUrl) {
        toast.error('Enter a valid http(s) URL to start a session.');
        return;
    }
    // Last gate before the network call — the engine dials this address verbatim
    // and cannot reach a private host.
    if (isPrivateTargetUrl(resolvedUrl)) {
        toast.error(PUBLIC_TARGET_REQUIRED_MESSAGE);
        return;
    }

    const settings = optimizationSettings ?? defaultOptimizationSettings;
    const timeboxMs = settings['execution-timebox-ms'] ?? defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;

    const gateway = getEngineGateway();
    const store = useRunStore.getState();
    store.resetForLaunch(timeboxMs, resolvedUrl);

    try {
        const { runId, runCode, jobId, queued, resumed } = await gateway.startTest(resolvedUrl, settings, infiltration, targetAuth);
        // Persist the server-issued run token so a refresh / reconnect re-attaches
        if (runId) writeStorage(RUN_ID_STORAGE_KEY, runId);
        // The run's public code identifies it at save time — always overwrite, so a
        // new run can never be saved under the previous run's code.
        writeStorage(RUN_CODE_STORAGE_KEY, runCode);
        if (jobId) writeStorage(JOB_ID_STORAGE_KEY, jobId);
        useRunStore.setState({ isLaunching: false });

        // The server matched an existing session we own — hydrate from its snapshot
        // rather than treating this as a fresh launch.
        if (resumed) {
            toast('Reconnected to your existing session — resuming instead of starting a new one.', { id: STATUS_TOAST_ID });
            useRunStore.setState({ isInitializing: false });
            const snapshot = await gateway.fetchActiveSession();
            if (snapshot) useRunStore.getState().hydrateFromSnapshot(snapshot);
            return;
        }

        // Queued runs haven't launched an engine yet: drop into standby and disarm the
        // 30s no-frame watchdog. The queued toast comes from the backend push, which is
        // the single source of truth for it.
        if (queued) useRunStore.setState((s) => ({ status: resolveStatus(s.status, 'QUEUED'), isInitializing: false }));
    } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        // The backend refuses authenticated runs only when its credential-encryption
        // key is unset — a deployment misconfig, not a product limit. Surface the fix.
        const isAuthOnQueue = raw.includes('AUTH_UNSUPPORTED_ON_QUEUE');
        const message = isAuthOnQueue
            ? 'Authenticated runs need the server credential key (BUGSAFARI_AUTH_KEY) configured. Ask an operator to set it, or run with the queue disabled.'
            : raw;
        if (isAuthOnQueue) toast.error(message, { id: STATUS_TOAST_ID });
        useRunStore.getState().markLaunchFailed(message);
    }
}

export function pauseRun(): void {
    if (useRunStore.getState().status !== 'ACTIVE') return;
    getEngineGateway().pauseTest();
}

export function resumeRun(): void {
    if (useRunStore.getState().status !== 'PAUSED') return;
    getEngineGateway().resumeTest();
}

export async function stopRun(): Promise<void> {
    const gateway = getEngineGateway();
    const status = useRunStore.getState().status;

    // A QUEUED run holds no engine — the socket stop channel would reach nothing.
    // Cancel the BullMQ job instead, and only reset once the backend confirms.
    if (status === 'QUEUED') {
        if (runRefs.cancelInFlight) return;
        runRefs.cancelInFlight = true;
        let result;
        try {
            result = await gateway.cancelQueuedRun();
        } finally {
            runRefs.cancelInFlight = false;
        }
        if (!result.ok) {
            toast.error(result.error ?? 'Could not cancel the queued session.');
            return;
        }
        useRunStore.getState().resetAfterCancel();
        toast.success(result.cancelled ? 'Queued session cancelled.' : (result.message ?? 'Session stopped.'));
        useRunStore.getState().pushTelemetry(actionEvent('Queued session cancelled before execution.'));
        return;
    }

    // STARTING included: the engine may be booting; the backend defers the stop
    // (pendingStop) and applies it the instant the engine attaches.
    if (status === 'ACTIVE' || status === 'PAUSED' || status === 'STARTING') {
        gateway.stopTest();
    }
}

export async function refreshHistory(): Promise<void> {
    const history = await getEngineGateway().fetchSessionHistory(60);
    useRunStore.getState().setSessionHistory(history);
}

export async function saveRun(inputTargetUrl: string): Promise<void> {
    const store = useRunStore.getState();
    // Idempotent by design — an in-flight or already-committed save is a no-op
    if (store.isSavingSession || store.isSessionSaved) return;

    store.setSavingSession(true);
    try {
        const { currentUrl, incidents, reports, networkEvents, browserConsole, elapsedTimeMs } = useRunStore.getState();
        const runtimeUrl = currentUrl || inputTargetUrl;
        // Exact live findings so saved history mirrors the Error Tab with full parity
        const liveFindings = buildLiveFindings(incidents, reports);

        // The run executes out-of-process, so these buffers are the only complete
        // source at save time. Dedup by method+url+status so a polled endpoint
        // collapses to one row with a repeatCount instead of flooding the tab.
        const networkMap = new Map<string, { timestamp: string; method: string; url: string; statusCode?: number; durationMs?: number; ok: boolean; message?: string; repeatCount: number }>();
        for (const e of networkEvents) {
            if (e.type !== 'NETWORK') continue;
            // Only actionable failures are saved — successes are noise (matches the live tab).
            if (!isActionableNetworkStatus(e.meta?.statusCode)) continue;
            const method = e.meta?.method ?? 'GET';
            const url = e.meta?.url ?? '';
            const statusCode = e.meta?.statusCode;
            const key = `${method}|${url}|${statusCode ?? ''}`;
            const existing = networkMap.get(key);
            if (existing) {
                existing.repeatCount += 1;
                if (typeof e.meta?.durationMs === 'number') existing.durationMs = e.meta.durationMs;
            } else {
                networkMap.set(key, {
                    timestamp: e.timestamp,
                    method,
                    url,
                    statusCode,
                    durationMs: e.meta?.durationMs,
                    ok: typeof statusCode === 'number' ? statusCode < 400 : true,
                    message: e.meta?.message,
                    repeatCount: 1,
                });
            }
        }

        const consoleLog = browserConsole.map((c) => ({
            timestamp: c.timestamp,
            level: c.level,
            type: c.type,
            message: c.message,
            url: c.url,
            line: c.line,
            column: c.column,
            stackTrace: c.stackTrace,
        }));

        // Duration fallback: if the worker timer snapshot never populated elapsed, use
        // the wall-clock span so the saved report never shows Duration N/A.
        const effectiveElapsedMs = elapsedTimeMs > 0
            ? elapsedTimeMs
            : (runRefs.runStartWallClock > 0 ? Date.now() - runRefs.runStartWallClock : 0);

        // Save requires authentication (throws 403 for guests)
        await saveSessionToHistory(runtimeUrl.trim(), {
            initialUrl: inputTargetUrl.trim(),
            // Identifies the run server-side, so a repeated save rewrites its document
            // instead of minting a second one under a fresh code.
            runId: readStorage(RUN_CODE_STORAGE_KEY),
            elapsedTimeMs: effectiveElapsedMs,
            findings: liveFindings,
            networkLog: [...networkMap.values()],
            consoleLog,
        });

        useRunStore.getState().markSessionSaved();
        await refreshHistory();
        useRunStore.getState().pushTelemetry(actionEvent('Session has been committed to history.', 'session-saved'));
    } catch (error) {
        const err = error as Error & { code?: string; status?: number };
        const isGuestRejection = err?.code === 'GUEST_FORBIDDEN' || err?.status === 403;
        const message = error instanceof Error ? error.message : String(error);

        useRunStore.getState().pushTelemetry({
            timestamp: new Date().toISOString(),
            type: 'EXCEPTION',
            meta: {
                message: isGuestRejection
                    ? 'Registration required to save session history. Please sign in or create an account.'
                    : `Save Session failed: ${message}`,
            },
        });
        throw error;
    } finally {
        useRunStore.getState().setSavingSession(false);
    }
}

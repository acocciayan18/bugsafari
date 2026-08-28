import { toast } from '../../infrastructure/notifications/ToastProvider';
import type { OptimizationSettings, TargetAuthConfig, ExplorationRunConfig, TelemetryEvent, ActiveSessionSnapshot } from '../../types';
import { defaultOptimizationSettings } from '../../../../shared/types.js';
import { normalizeTargetUrl, isPrivateTargetUrl, PUBLIC_TARGET_REQUIRED_MESSAGE, SELF_TARGET_FORBIDDEN_MESSAGE } from '../../../../shared/url.js';
import { isSelfTargetUrl } from '../../utils/selfTarget';
import { saveSessionToHistory } from '../../services/historyService';
import { buildLiveFindings } from '../../utils/findingsBuilder';
import { buildSavedNetworkRows } from '../../utils/networkLogBuilder';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import type { RunControlOutcome } from '../../application/ports/EngineGateway';
import { canApplyRollback, refusalMessage, shouldRollbackControl } from './controlOutcome';
import { useRunStore, runRefs } from './runStore';
import { RUN_ID_STORAGE_KEY, RUN_CODE_STORAGE_KEY, JOB_ID_STORAGE_KEY, RUN_CONTROL_STORAGE_KEY, STATUS_TOAST_ID, resolveStatus, resolvePendingReissue, type TestSessionStatus } from './types';

// Remember a pause/stop/resume the operator just issued, keyed to this run's code, so a
// refresh landing mid-transition can re-issue it instead of silently resuming the run.
function writePendingControl(kind: 'pause' | 'stop' | 'resume'): void {
    writeStorage(RUN_CONTROL_STORAGE_KEY, `${kind}:${readStorage(RUN_CODE_STORAGE_KEY) ?? ''}`);
}

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
    // BugSafari must never test itself — refuse a BugSafari production/preview/staging
    // or self-served origin before the request leaves the browser (backend re-checks).
    if (isSelfTargetUrl(resolvedUrl)) {
        toast.error(SELF_TARGET_FORBIDDEN_MESSAGE);
        return;
    }

    // Synchronous in-flight latch: closes the same-tick double-submit window before
    // the awaited POST. Backend admission (tryActivate) is the backstop.
    if (runRefs.startInFlight) return;
    runRefs.startInFlight = true;

    const settings = optimizationSettings ?? defaultOptimizationSettings;
    const timeboxMs = settings['execution-timebox-ms'] ?? defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;

    const gateway = getEngineGateway();
    const store = useRunStore.getState();
    // A fresh launch retires any pending control intent from a prior run.
    writeStorage(RUN_CONTROL_STORAGE_KEY, null);
    store.resetForLaunch(timeboxMs, resolvedUrl);

    try {
        const { runId, runCode, jobId, resumed } = await gateway.startTest(resolvedUrl, settings, infiltration, targetAuth);
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
            toast('Reconnected to your existing session. Resuming instead of starting a new one.', { id: STATUS_TOAST_ID });
            useRunStore.setState({ isInitializing: false });
            const snapshot = await gateway.fetchActiveSession();
            if (snapshot) {
                useRunStore.getState().hydrateFromSnapshot(snapshot);
                reissuePendingControl(snapshot);
            }
            return;
        }

        // No optimistic QUEUED. subscribeQueue (in gateway.startTest) triggers an
        // immediate queue push: 'waiting' → QUEUED with a real position for a genuine
        // wait, 'active' → ACTIVE on instant pickup. Flipping to QUEUED here forced a
        // transient standby frame that reverted the moment that push landed.
    } catch (error) {
        const err = error as Error & { status?: number; code?: string };
        const raw = error instanceof Error ? error.message : String(error);
        // The backend refuses authenticated runs only when its credential-encryption
        // key is unset — a deployment misconfig, not a product limit. Surface the fix.
        const isAuthOnQueue = raw.includes('AUTH_UNSUPPORTED_ON_QUEUE');
        if (isAuthOnQueue) console.error('[runCommands] Authenticated runs require the server credential key (BUGSAFARI_AUTH_KEY) to be configured.');
        // Guest limit rejections carry the server's prose (rate/cooldown, one-run,
        // Target-Auth-disabled); surface it so the block is legible, not silent.
        const isGuestLimit = err.status === 429 || err.status === 403
            || err.code === 'RATE_LIMITED' || err.code === 'GUEST_TARGET_AUTH_FORBIDDEN';
        const message = isAuthOnQueue
            ? "Authenticated runs aren't available right now. Try again later, or start a run without signing in to the target."
            : raw;
        if (isAuthOnQueue || isGuestLimit) toast.error(message, { id: STATUS_TOAST_ID });
        useRunStore.getState().markLaunchFailed(message);
    } finally {
        // Release the latch once the POST settles; isActiveSession now gates the UI.
        runRefs.startInFlight = false;
    }
}

/**
 * Apply a control outcome. `resolveStatus` is bypassed on rollback deliberately: this is
 * an authoritative correction, and PAUSING→ACTIVE is not a forward transition the state
 * machine would otherwise allow.
 */
function applyControlOutcome(
    outcome: RunControlOutcome,
    from: TestSessionStatus,
    optimistic: TestSessionStatus,
    verb: string,
): void {
    if (!shouldRollbackControl(outcome)) return;
    if (!canApplyRollback(useRunStore.getState().status, optimistic)) return; // already moved on
    useRunStore.setState({ status: from });
    writeStorage(RUN_CONTROL_STORAGE_KEY, null);
    toast.error(refusalMessage(outcome.reason, verb), { id: STATUS_TOAST_ID });
}

export async function pauseRun(): Promise<void> {
    const status = useRunStore.getState().status;
    if (status !== 'ACTIVE') return;
    writePendingControl('pause');
    // Optimistic transition (via the state machine) so the control locks immediately
    // instead of staying clickable until the engine's telemetry round-trip lands.
    useRunStore.setState({ status: resolveStatus(status, 'PAUSING') });
    applyControlOutcome(await getEngineGateway().pauseTest(), status, 'PAUSING', 'pause');
}

export async function resumeRun(): Promise<void> {
    const status = useRunStore.getState().status;
    if (status !== 'PAUSED') return;
    writePendingControl('resume');
    useRunStore.setState({ status: resolveStatus(status, 'ACTIVE') });
    applyControlOutcome(await getEngineGateway().resumeTest(), status, 'ACTIVE', 'resume');
}

// Restore-time recovery for a control command issued just before a refresh. The socket
// emit dies with the old page, so hydrate lands the run back on ACTIVE/PAUSED; re-issue
// the persisted intent once against the same still-live run. Idempotent — a snapshot that
// already reflects the command yields no re-issue, and the backend guards duplicates.
export function reissuePendingControl(snapshot: ActiveSessionSnapshot): void {
    const pending = readStorage(RUN_CONTROL_STORAGE_KEY);
    if (!pending) return;
    const sep = pending.indexOf(':');
    const kind = sep >= 0 ? pending.slice(0, sep) : pending;
    const runCode = sep >= 0 ? pending.slice(sep + 1) : '';
    writeStorage(RUN_CONTROL_STORAGE_KEY, null); // one-shot, whatever the outcome
    if (runCode && snapshot.runId && runCode !== snapshot.runId) return; // stale — different run
    const action = resolvePendingReissue(kind, useRunStore.getState().status);
    if (!action) return;
    const gateway = getEngineGateway();
    const current = useRunStore.getState().status;
    if (action === 'stop') { void gateway.stopTest(); useRunStore.setState({ status: resolveStatus(current, 'STOPPING') }); }
    else if (action === 'pause') { void gateway.pauseTest(); useRunStore.setState({ status: resolveStatus(current, 'PAUSING') }); }
    else { void gateway.resumeTest(); useRunStore.setState({ status: resolveStatus(current, 'ACTIVE') }); }
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
        writePendingControl('stop');
        // Optimistic transition so Stop/Pause/Resume lock immediately (spam window).
        useRunStore.setState({ status: resolveStatus(status, 'STOPPING') });
        applyControlOutcome(await gateway.stopTest(), status, 'STOPPING', 'stop');
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
        // source at save time. buildSavedNetworkRows is the SAME builder the live
        // Network badge counts, so the saved log and the live tab can never diverge.
        const networkLog = buildSavedNetworkRows(networkEvents);

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
            networkLog,
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

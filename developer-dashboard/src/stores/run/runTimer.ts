import { useRunStore, runRefs } from './runStore';
import { interpolateElapsedMs, type TestSessionStatus } from './types';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';

let interval: ReturnType<typeof setInterval> | null = null;
// One stop dispatch per run — only used by the engine-overrun safety net below.
let expiryDispatched = false;
// Wall-clock when the display first hit 0 while still ACTIVE (0 = not at zero).
let zeroSince = 0;

// Smooth display cadence. The value is authoritative-corrected every ~1s by the
// engine's time-sync, so 250ms is purely for a fluid countdown between corrections.
const DISPLAY_TICK_MS = 250;
// Engine is the sole timebox terminator. Only if it overruns this grace with no
// terminal telemetry (stuck / unreachable) does the client nudge a stop — long
// enough that the normal path never triggers it, so no race with the engine.
const TIMEBOX_GRACE_MS = 20000;
// Backend lifecycles that prove the engine is still alive and owns the timebox — a
// client stop here would kill a healthy run finishing on its own clock.
const LIVE_BACKEND_STATUSES = new Set(['STARTING', 'RUNNING', 'PAUSING', 'PAUSED', 'STOPPING', 'INTERRUPTED']);
// One liveness-gated nudge probe in flight at a time.
let nudgeInFlight = false;

function computeElapsedMs(status: TestSessionStatus): number {
    return interpolateElapsedMs(status, runRefs.timeSyncSeeded, runRefs.serverElapsedMs, runRefs.serverElapsedAt, Date.now());
}

function tick(): void {
    const store = useRunStore.getState();
    const elapsed = computeElapsedMs(store.status);
    const remaining = Math.max(0, store.activeTimeboxMs - elapsed);
    store.tick(remaining, elapsed);

    if (remaining > 0 || store.status !== 'ACTIVE') {
        zeroSince = 0;
        return;
    }
    // At zero: wait for the engine's terminal telemetry. Only nudge on a genuine
    // overrun (engine stuck/unreachable past the grace), and only after confirming
    // the backend no longer reports a live run — never stop a healthy engine.
    if (zeroSince === 0) zeroSince = Date.now();
    if (expiryDispatched || nudgeInFlight || Date.now() - zeroSince < TIMEBOX_GRACE_MS) return;
    void maybeNudgeTimeboxStop();
}

// Liveness-gated timebox backstop: probe the backend before nudging. If it still
// reports a live lifecycle, the engine owns the timebox — suppress and let its own
// telemetry settle the run. Only stop when the run is truly unreachable/terminal.
async function maybeNudgeTimeboxStop(): Promise<void> {
    nudgeInFlight = true;
    try {
        const snapshot = await getEngineGateway().fetchActiveSession();
        if (snapshot && LIVE_BACKEND_STATUSES.has(snapshot.status)) return; // engine alive — don't kill it
        expiryDispatched = true;
        useRunStore.getState().handleTimeLimitExceeded();
        await getEngineGateway().forceStop('timebox');
    } catch (error) {
        console.error('[runTimer] Timebox fallback stop failed:', error);
    } finally {
        nudgeInFlight = false;
    }
}

function stop(): void {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
}

function start(): void {
    if (interval) return;
    expiryDispatched = false;
    nudgeInFlight = false;
    zeroSince = 0;
    // Restart interpolation from the current authoritative elapsed on every ACTIVE
    // (re)entry — so a resume never counts the paused gap even before the engine's
    // resume-sync lands. serverElapsedMs holds the frozen elapsed; only the anchor moves.
    runRefs.serverElapsedAt = Date.now();
    tick();
    interval = setInterval(tick, DISPLAY_TICK_MS);
}

let initialized = false;

// The interval lives outside React, so a tick only re-renders components that
// select remainingTimeMs/elapsedTimeMs — not the whole authenticated tree. The
// timer runs only while ACTIVE (interpolating); pause/start/stop just freeze the
// last displayed value, which the next time-sync corrects on resume.
export function initRunTimer(): void {
    if (initialized) return;
    initialized = true;

    useRunStore.subscribe((state, prev) => {
        if (state.status === prev.status) return;
        if (state.status === 'ACTIVE') start();
        else stop();
    });
}

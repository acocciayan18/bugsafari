import { useRunStore, runRefs } from './runStore';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';

let interval: ReturnType<typeof setInterval> | null = null;
// One stop dispatch per run — the tick fires every second past the deadline.
let expiryDispatched = false;

function tick(): void {
    const store = useRunStore.getState();
    const remaining = Math.max(0, runRefs.runDeadline - Date.now());
    store.tick(remaining, Math.max(0, store.activeTimeboxMs - remaining));
    if (remaining > 0) return;

    store.handleTimeLimitExceeded();
    // Flipping the UI to FINISHED locally left the engine running headless until
    // its own internal timebox. Tell the backend the run is over.
    if (expiryDispatched) return;
    expiryDispatched = true;
    const gateway = getEngineGateway() as unknown as { forceStop?: () => Promise<void> };
    void gateway.forceStop?.().catch((error) => console.error('[runTimer] Timebox stop failed:', error));
}

function stop(): void {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
}

function start(): void {
    if (interval) return;
    expiryDispatched = false;
    if (runRefs.runDeadline <= 0) runRefs.runDeadline = Date.now() + useRunStore.getState().activeTimeboxMs;
    tick();
    interval = setInterval(tick, 1000);
}

let initialized = false;

// The interval lives outside React, so a tick only re-renders components that
// select remainingTimeMs/elapsedTimeMs — not the whole authenticated tree.
export function initRunTimer(): void {
    if (initialized) return;
    initialized = true;

    useRunStore.subscribe((state, prev) => {
        if (state.status === prev.status) return;

        // Freeze the deadline across pause so paused time is never counted
        if (state.status === 'PAUSED' || state.status === 'PAUSING') {
            if (runRefs.runDeadline > 0 && runRefs.pausedRemaining === 0) {
                runRefs.pausedRemaining = Math.max(0, runRefs.runDeadline - Date.now());
            }
        } else if (state.status === 'ACTIVE' && runRefs.pausedRemaining > 0) {
            runRefs.runDeadline = Date.now() + runRefs.pausedRemaining;
            runRefs.pausedRemaining = 0;
        }

        if (state.status === 'ACTIVE') start();
        else stop();
    });
}

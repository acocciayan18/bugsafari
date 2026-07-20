import { useRunStore, runRefs } from './runStore';

let interval: ReturnType<typeof setInterval> | null = null;

function tick(): void {
    const store = useRunStore.getState();
    const remaining = Math.max(0, runRefs.runDeadline - Date.now());
    store.tick(remaining, Math.max(0, store.activeTimeboxMs - remaining));
    if (remaining <= 0) store.handleTimeLimitExceeded();
}

function stop(): void {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
}

function start(): void {
    if (interval) return;
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

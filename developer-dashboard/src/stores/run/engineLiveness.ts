// Pure decision layer for "is the engine actually up?" — the frontend NEVER
// declares a startup failure on its own clock. A slow boot (cold container,
// 30s+ Playwright launch, queue pickup) is indistinguishable from a dead engine
// locally, so the only authority is the backend's own snapshot: live means keep
// waiting, terminal means show what the backend says, absent means we own nothing.
import type { ActiveSessionSnapshot } from '../../types';
import { lifecycleIsLive, lifecycleToStatus, type TestSessionStatus } from './types';

// A single missing snapshot can be a restarting API or a dropped request, not a
// dead run. Only a repeated absence is treated as proof the run is gone.
export const MISSES_BEFORE_RELEASE = 2;

export type ProbeOutcome =
    // Backend still owns a live run for us — boot is in progress, not failed.
    | { kind: 'alive'; snapshot: ActiveSessionSnapshot }
    // Backend reports the run reached a terminal state — it really did end.
    | { kind: 'terminal'; snapshot: ActiveSessionSnapshot }
    // Backend knows of no run for this client.
    | { kind: 'absent' };

// What the caller does next. 'wait' keeps the initializing UI exactly as it is.
export type ProbeAction = 'wait' | 'hydrate' | 'release';

export function classifyProbe(snapshot: ActiveSessionSnapshot | null): ProbeOutcome {
    if (!snapshot) return { kind: 'absent' };
    return lifecycleIsLive(snapshot.status)
        ? { kind: 'alive', snapshot }
        : { kind: 'terminal', snapshot };
}

/** What the dashboard currently shows, so a probe only writes when it corrects something. */
export interface LocalRunView {
    status: TestSessionStatus;
    hasLiveFrame: boolean;
}

/**
 * Map a probe result onto the one action the client may take. A live run NEVER
 * fails — at worst it is left exactly as it is. Hydration is reserved for the
 * cases where the snapshot actually corrects the dashboard, because hydrate
 * replaces the telemetry/incident buffers wholesale and the socket (not this
 * probe) is the live channel: re-applying a lagging snapshot over fresher socket
 * data would itself be a desync. Only a confirmed, repeated absence releases.
 */
export function decideProbeAction(
    outcome: ProbeOutcome,
    consecutiveMisses: number,
    local: LocalRunView,
): ProbeAction {
    if (outcome.kind === 'absent') {
        return consecutiveMisses >= MISSES_BEFORE_RELEASE ? 'release' : 'wait';
    }
    // A terminal verdict always wins — it is the backend confirming the run ended.
    if (outcome.kind === 'terminal') return 'hydrate';
    // Live: correct the dashboard only when it disagrees with the backend, or when
    // the snapshot carries a frame the live feed is still missing.
    const backendStatus = lifecycleToStatus(outcome.snapshot.status);
    const statusDrifted = backendStatus !== local.status;
    const frameRecoverable = Boolean(outcome.snapshot.lastFrame) && !local.hasLiveFrame;
    return statusDrifted || frameRecoverable ? 'hydrate' : 'wait';
}

// Misses only accumulate on a confirmed absence; any answer from the backend
// (live or terminal) resets the counter.
export function nextMissCount(outcome: ProbeOutcome, consecutiveMisses: number): number {
    return outcome.kind === 'absent' ? consecutiveMisses + 1 : 0;
}

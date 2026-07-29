import type { RunLifecycleStatus } from '../../types';
import { TOAST_ID } from '../../infrastructure/notifications/toastId';

// Unified Test Session Status Type for the visibility matrix. STARTING is the
// neutral launch state shown before the server decides QUEUED vs ACTIVE — it
// replaces the old optimistic ACTIVE that flickered ACTIVE→QUEUED→ACTIVE.
export type TestSessionStatus = 'IDLE' | 'STARTING' | 'QUEUED' | 'ACTIVE' | 'PAUSING' | 'PAUSED' | 'STOPPING' | 'STOPPED' | 'FINISHED';

// Deterministic control-state machine: the only forward transitions the UI may
// apply from a racing socket/queue push. Authoritative writes (launch reset,
// snapshot hydrate, terminal, explicit IDLE) bypass this and set status directly.
const STATUS_TRANSITIONS: Record<TestSessionStatus, readonly TestSessionStatus[]> = {
    IDLE: ['STARTING', 'QUEUED', 'ACTIVE', 'STOPPED', 'FINISHED'],
    STARTING: ['QUEUED', 'ACTIVE', 'PAUSING', 'PAUSED', 'STOPPING', 'STOPPED', 'FINISHED', 'IDLE'],
    QUEUED: ['ACTIVE', 'STOPPING', 'STOPPED', 'FINISHED', 'IDLE'],
    ACTIVE: ['PAUSING', 'PAUSED', 'STOPPING', 'STOPPED', 'FINISHED', 'IDLE'],
    PAUSING: ['PAUSED', 'ACTIVE', 'STOPPING', 'STOPPED', 'FINISHED', 'IDLE'],
    PAUSED: ['ACTIVE', 'PAUSING', 'STOPPING', 'STOPPED', 'FINISHED', 'IDLE'],
    STOPPING: ['STOPPED', 'FINISHED', 'IDLE'],
    STOPPED: ['IDLE', 'STARTING', 'QUEUED', 'ACTIVE'],
    FINISHED: ['IDLE', 'STARTING', 'QUEUED', 'ACTIVE'],
};

// Returns `next` if it is a valid transition from `current`, else `current` —
// so a stale/out-of-order push (e.g. ACTIVE→QUEUED) is dropped, never rendered.
export function resolveStatus(current: TestSessionStatus, next: TestSessionStatus): TestSessionStatus {
    if (current === next) return current;
    return STATUS_TRANSITIONS[current].includes(next) ? next : current;
}

// Authoritative-clock display: elapsed = last engine-reported elapsed + wall-clock
// since, but ONLY while ACTIVE and seeded. Before the first sync (boot/queue) or
// while paused it stays frozen, so boot/queue/pause time is never counted. Pure so
// the frontend timer never runs an independent countdown.
export function interpolateElapsedMs(
    status: TestSessionStatus,
    seeded: boolean,
    serverElapsedMs: number,
    serverElapsedAt: number,
    now: number,
): number {
    if (status !== 'ACTIVE' || !seeded) return serverElapsedMs;
    return serverElapsedMs + Math.max(0, now - serverElapsedAt);
}

export interface QueueUpdate {
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled';
    position: number | null;
    queueDepth: number;
    // Runs executing on the fleet right now, and the slots it exposes (one per
    // worker replica). workerCount is null when Redis cannot report it.
    activeCount: number;
    workerCount: number | null;
    message?: string;
}

// Matches the backend replay buffer (SessionManager CONSOLE_BUFFER_CAP) so a
// reconnect restores the same window the operator was watching.
export const CONSOLE_BUFFER_CAP = 200;
export const TELEMETRY_CAP = 500;
export const NETWORK_CAP = 200;

// Server-issued run token — lets a guest survive a full page refresh
export const RUN_ID_STORAGE_KEY = 'bugsafari:runId';
// Public RUN- code of the run — replayed on save so it targets the run's own document
export const RUN_CODE_STORAGE_KEY = 'bugsafari:runCode';
// jobId of an enqueued distributed run — needed to rejoin the queue-position stream
export const JOB_ID_STORAGE_KEY = 'bugsafari:jobId';

// Now the same app-wide slot — kept as an alias so callers don't need to change.
export const STATUS_TOAST_ID = TOAST_ID;

export const ENGINE_TERMINAL_ACTIONS = new Set([
    'engine-stopped',
    'engine-finished',
    'engine-halted',
    'timebox-exceeded',
]);

export const ENGINE_PAUSE_ACTIONS = new Set(['engine-paused']);
export const ENGINE_RESUME_ACTIONS = new Set(['engine-resumed']);

// Transitional signals — the backend is settling in-flight tasks; controls stay locked
export const ENGINE_PAUSING_ACTIONS = new Set(['engine-pausing']);
export const ENGINE_STOPPING_ACTIONS = new Set(['engine-stopping']);

export function lifecycleToStatus(status: RunLifecycleStatus): TestSessionStatus {
    switch (status) {
        case 'QUEUED':
            return 'QUEUED';
        case 'STARTING':      // room reserved, engine booting — the run is ours already
            return 'STARTING';
        case 'RUNNING':
        case 'INTERRUPTED':   // engine still alive inside the grace window
            return 'ACTIVE';
        case 'PAUSING':
            return 'PAUSING';
        case 'PAUSED':
            return 'PAUSED';
        case 'STOPPING':
            return 'STOPPING';
        case 'COMPLETED':
        case 'DISCONNECTED':
            return 'FINISHED';
        case 'CRASHED':
        case 'CRASH_COMPLETED':   // target server crash confirmed by the health probe
            return 'STOPPED';
        default:
            return 'IDLE';
    }
}

// A run is still live (config controls stay locked) for these lifecycle states
export function lifecycleIsLive(status: RunLifecycleStatus): boolean {
    return status === 'QUEUED' || status === 'STARTING' || status === 'RUNNING' || status === 'PAUSING'
        || status === 'PAUSED' || status === 'STOPPING' || status === 'INTERRUPTED';
}

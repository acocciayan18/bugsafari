import type { RunLifecycleStatus } from '../../types';

// Unified Test Session Status Type for the visibility matrix
export type TestSessionStatus = 'IDLE' | 'QUEUED' | 'ACTIVE' | 'PAUSING' | 'PAUSED' | 'STOPPING' | 'STOPPED' | 'FINISHED';

export interface QueueUpdate {
    state: 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled';
    position: number | null;
    queueDepth: number;
    message?: string;
}

// Matches the backend replay buffer (SessionManager CONSOLE_BUFFER_CAP) so a
// reconnect restores the same window the operator was watching.
export const CONSOLE_BUFFER_CAP = 200;
export const TELEMETRY_CAP = 500;
export const NETWORK_CAP = 200;

// Server-issued run token — lets a guest survive a full page refresh
export const RUN_ID_STORAGE_KEY = 'bugsafari:runId';
// jobId of an enqueued distributed run — needed to rejoin the queue-position stream
export const JOB_ID_STORAGE_KEY = 'bugsafari:jobId';

// Single shared toast slot so a newer status replaces the previous one in place
export const STATUS_TOAST_ID = 'session-status';

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

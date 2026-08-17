import { MAX_TIMEBOX_MS } from '../../../../shared/types.js';

// The BullMQ lock must outlast the longest possible run, or a long (20-30 min) job
// whose event loop briefly stalls is declared stalled and re-delivered as a duplicate.
const LOCK_HEADROOM_MS = 60_000;

// Job lock ceiling = max timebox + teardown headroom. Must exceed MAX_TIMEBOX_MS.
export const SAFARI_JOB_LOCK_DURATION_MS = MAX_TIMEBOX_MS + LOCK_HEADROOM_MS;

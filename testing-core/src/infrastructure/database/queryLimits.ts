// Hard ceiling on per-run forensic row reads. A single run can emit thousands of
// network/console rows; unbounded finds hydrate all of them into memory at once.
export const MAX_FORENSIC_ROWS = 5000;

// Telemetry rows carried in a reconnect/restore snapshot. Mirrors the client's
// TELEMETRY_CAP: the dashboard slices to this tail on hydrate, so shipping more just
// inflates the payload and the synchronous parse/fold before first paint.
export const SNAPSHOT_TELEMETRY_LIMIT = 500;

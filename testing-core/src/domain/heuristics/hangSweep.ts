// Pure sweep schedule for the infinite-loading watchdog. A request pending past the hang
// threshold is probed, then RE-probed on a widening backoff: apps frequently render their
// spinner after the first probe (late loading state, or a retry layer re-arming it), so a
// single check silently missed those hangs. Extracted so the timing policy is testable
// without a live Page — same split as networkAttribution.

export interface SweepState {
  /** Probes already fired for this request. */
  sweeps: number;
  /** Wall-clock instant the next probe becomes due. */
  nextSweepAtMs: number;
}

export interface SweepPolicy {
  /** Pending time before the first probe. */
  thresholdMs: number;
  /** Backoff base; attempt N waits base × N before the next probe. */
  reSweepBaseMs: number;
  /** Probe budget per request — bounds cost for a permanently-open stream (SSE/long-poll). */
  maxSweeps: number;
}

/** Initial schedule for a newly tracked in-flight request. */
export function initialSweepState(startMs: number, policy: SweepPolicy): SweepState {
  return { sweeps: 0, nextSweepAtMs: startMs + policy.thresholdMs };
}

/** True when this request is due for a probe and still has budget left. */
export function isSweepDue(state: SweepState, nowMs: number, policy: SweepPolicy): boolean {
  return state.sweeps < policy.maxSweeps && nowMs >= state.nextSweepAtMs;
}

/** Schedule after firing a probe at `nowMs`. Pure — returns the next state. */
export function advanceSweep(state: SweepState, nowMs: number, policy: SweepPolicy): SweepState {
  const sweeps = state.sweeps + 1;
  return { sweeps, nextSweepAtMs: nowMs + policy.reSweepBaseMs * sweeps };
}

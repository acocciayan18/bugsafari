// Network connectivity phase surfaced to the operator, derived by the dashboard
// from socket lifecycle + the engine's target-reachability action markers below.
export type NetworkPhase =
  | 'ONLINE'          // everything reachable
  | 'DEGRADED'        // target flaky; findings quarantined, exploration still running
  | 'PAUSED_NETWORK'  // target confirmed unreachable; engine auto-paused, retrying
  | 'RECONNECTING'    // dashboard↔backend socket dropped, auto-reconnecting
  | 'LOST';           // reconnect budget exhausted — reload required

// actionExecuted markers the engine emits on ACTION telemetry so the dashboard can
// derive the target-network phase without a bespoke socket channel (these ride the
// existing room-scoped, buffered, replayed telemetry stream for free).
export const NETWORK_ACTION = {
  DEGRADED: 'target-network-degraded',
  RECOVERED: 'target-network-recovered',
  PAUSED: 'engine-network-paused',
  RESUMED: 'engine-network-resumed',
} as const;

export type NetworkActionMarker = (typeof NETWORK_ACTION)[keyof typeof NETWORK_ACTION];

// Every marker as a set for cheap membership checks on the dashboard.
export const NETWORK_ACTION_MARKERS: ReadonlySet<string> = new Set(Object.values(NETWORK_ACTION));

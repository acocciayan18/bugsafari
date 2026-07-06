import type { StateHash, PathfinderEvent, PathfinderEventKind } from '../DIrectedPathFinder.js';

/**
 * Ring-buffer event log for dashboard telemetry. Decoupled from the traversal
 * stack via an injected path-trace callback so it has no dependency on how
 * (or where) the current DFS path is tracked.
 */
export class EventLog {
  private readonly events: PathfinderEvent[] = [];
  private readonly maxEvents = 200;

  constructor(private readonly buildPathTrace: (actionSuffix: string) => string) {}

  recordEvent(kind: PathfinderEventKind, nodeHash: StateHash, detail: string): void {
    const event: PathfinderEvent = {
      kind,
      timestamp: Date.now(),
      nodeHash,
      detail,
      pathTrace: this.buildPathTrace(detail),
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /** Return the most recent PathfinderEvent records (up to `limit`). */
  recentEvents(limit = 20): PathfinderEvent[] {
    return this.events.slice(-limit);
  }
}

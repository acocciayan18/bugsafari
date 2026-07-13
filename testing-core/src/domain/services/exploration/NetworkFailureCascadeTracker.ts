// Short-window burst detector for raw failed network events, giving rapid-fire scenarios an earlier back-off signal than the heartbeat freeze detector.

/** Rolling window in which failures are counted — well under the ~12-failure freeze observed. */
const CASCADE_WINDOW_MS = 2_000;
/** Failures within the window before a burst is declared cascading. */
const CASCADE_THRESHOLD = 5;

export class NetworkFailureCascadeTracker {
  private timestamps: number[] = [];

  constructor(
    private readonly windowMs: number = CASCADE_WINDOW_MS,
    private readonly threshold: number = CASCADE_THRESHOLD,
  ) {}

  /** Drop entries that have aged out of the rolling window. */
  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  /** Record one failed network event (call on the raw failure, unfiltered). */
  public recordFailure(nowMs: number = Date.now()): void {
    this.prune(nowMs);
    this.timestamps.push(nowMs);
  }

  /** True once `threshold` failures have landed within the rolling window. */
  public isCascading(nowMs: number = Date.now()): boolean {
    this.prune(nowMs);
    return this.timestamps.length >= this.threshold;
  }

  /** Clear all state at the start of a new Safari run. */
  public reset(): void {
    this.timestamps = [];
  }
}

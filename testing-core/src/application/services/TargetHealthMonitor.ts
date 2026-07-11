// Periodic reachability probe for the system-under-test. Runs OUT of the
// exploration loop (SessionManager owns it) and drives the engine's existing
// pause()/resume() so a target outage safely freezes execution — without
// consuming the timebox — and auto-resumes once the target is reachable again.

export interface TargetHealthCallbacks {
  /** Target confirmed unreachable after `attempt` consecutive failures (>= threshold). */
  onUnreachable(attempt: number, nextRetryMs: number): void;
  /** Target recovered from a confirmed outage after `failures` misses. Fired once per outage. */
  onRecovered(failures: number): void;
}

export class TargetHealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private stopped = false;
  private consecutiveFailures = 0;
  // Distinguishes a transient miss (below threshold, keep exploring) from a
  // confirmed outage that actually paused the engine.
  private outageReported = false;

  constructor(
    private readonly targetUrl: string,
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
    private readonly callbacks: TargetHealthCallbacks,
    // Consecutive failed probes required before declaring the target down. A
    // single blip / slow response past the timeout is transient, not an outage.
    private readonly failureThreshold: number = 2,
  ) {}

  /** Begin probing after one interval's grace so launch navigation isn't misread. */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isHealthy(): boolean {
    return !this.outageReported;
  }

  private async tick(): Promise<void> {
    // Skip overlapping probes if a slow request outlives the interval.
    if (this.probing || this.stopped) return;
    this.probing = true;
    try {
      const reachable = await this.check();
      if (this.stopped) return;

      if (!reachable) {
        this.consecutiveFailures += 1;
        // Only pause once failures cross the threshold — a lone transient miss
        // is ignored so exploration isn't frozen by an isolated blip. Keeps
        // firing every tick after that so the dashboard shows retry progress.
        if (this.consecutiveFailures >= this.failureThreshold) {
          this.outageReported = true;
          this.callbacks.onUnreachable(this.consecutiveFailures, this.intervalMs);
        }
      } else if (this.outageReported) {
        const failures = this.consecutiveFailures;
        this.outageReported = false;
        this.consecutiveFailures = 0;
        this.callbacks.onRecovered(failures);
      } else {
        // Recovered before crossing the threshold — transient, no pause happened.
        this.consecutiveFailures = 0;
      }
    } finally {
      this.probing = false;
    }
  }

  // A network-level failure (throw/timeout) means unreachable; any HTTP status
  // < 500 — including 4xx — means the server answered, so the target is up.
  private async check(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.targetUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
      });
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

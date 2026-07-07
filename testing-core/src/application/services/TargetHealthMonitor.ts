// Periodic reachability probe for the system-under-test. Runs OUT of the
// exploration loop (SessionManager owns it) and drives the engine's existing
// pause()/resume() so a target outage safely freezes execution — without
// consuming the timebox — and auto-resumes once the target is reachable again.

export interface TargetHealthCallbacks {
  /** Target became (or remains) unreachable after `attempt` consecutive failures. */
  onUnreachable(attempt: number, nextRetryMs: number): void;
  /** Target recovered after `failures` consecutive misses. Fired once per outage. */
  onRecovered(failures: number): void;
}

export class TargetHealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private stopped = false;
  private consecutiveFailures = 0;
  private wasUnreachable = false;

  constructor(
    private readonly targetUrl: string,
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
    private readonly callbacks: TargetHealthCallbacks,
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
    return !this.wasUnreachable;
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
        this.wasUnreachable = true;
        this.callbacks.onUnreachable(this.consecutiveFailures, this.intervalMs);
      } else if (this.wasUnreachable) {
        const failures = this.consecutiveFailures;
        this.wasUnreachable = false;
        this.consecutiveFailures = 0;
        this.callbacks.onRecovered(failures);
      } else {
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

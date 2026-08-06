// Periodic reachability probe for the system-under-test. Runs OUT of the
// exploration loop (SessionManager owns it) using the shared isolated Node HTTP
// client — never the browser thread. Its sole job is to confirm a genuine target
// outage and escalate it to a Critical Server Crash that terminates the run;
// transient blips are absorbed by resetting the counter on the next reachable probe.

import { isServerReachable } from '../../infrastructure/monitoring/serverReachability.js';

export interface TargetHealthCallbacks {
  /**
   * Target still unreachable after `failures` consecutive verification probes
   * (>= crashThreshold): a genuine server crash, not a transient blip. Fired
   * exactly once, after which probing stops — the caller terminates the run.
   */
  onCrash(failures: number): void;
  // Target unreachable for `failures` probes (>= degradeThreshold, < crashThreshold):
  // a sustained-but-not-yet-fatal outage. Fired once on entering the degraded state;
  // the caller pauses exploration. Probing continues so recovery/crash is still seen.
  onDegraded?(failures: number): void;
  // A probe succeeded while degraded — the target is back. The caller resumes.
  onRecovered?(): void;
}

export class TargetHealthMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private probing = false;
  private stopped = false;
  private consecutiveFailures = 0;
  // Latches once the crash escalation has fired so it can never double-fire.
  private crashReported = false;
  // True between onDegraded and onRecovered so each transition fires exactly once.
  private degraded = false;

  constructor(
    private readonly targetUrl: string,
    private readonly intervalMs: number,
    private readonly timeoutMs: number,
    private readonly callbacks: TargetHealthCallbacks,
    // Consecutive failed probes required to escalate a suspected outage into a
    // confirmed server crash that terminates the run.
    private readonly crashThreshold: number = 3,
    // Consecutive failed probes required to declare a transient outage and pause
    // exploration; must be below crashThreshold to give a pause window before a kill.
    private readonly degradeThreshold: number = 2,
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

  private async tick(): Promise<void> {
    // Skip overlapping probes if a slow request outlives the interval.
    if (this.probing || this.stopped) return;
    this.probing = true;
    try {
      const reachable = await this.check();
      if (this.stopped) return;

      if (reachable) {
        // A single reachable probe clears any accumulated transient failures.
        this.consecutiveFailures = 0;
        // Target came back after a transient outage — lift the pause exactly once.
        if (this.degraded) {
          this.degraded = false;
          this.callbacks.onRecovered?.();
        }
        return;
      }

      this.consecutiveFailures += 1;
      // Transient outage: pause exploration (findings would be false positives) but
      // keep probing so recovery or a full crash is still detected. Fires once.
      if (this.consecutiveFailures >= this.degradeThreshold && !this.degraded && !this.crashReported) {
        this.degraded = true;
        this.callbacks.onDegraded?.(this.consecutiveFailures);
      }
      // Escalate to a confirmed crash once verification has failed enough times;
      // stop probing and let the caller terminate. Latched so it fires once.
      if (this.consecutiveFailures >= this.crashThreshold && !this.crashReported) {
        this.crashReported = true;
        this.stop();
        this.callbacks.onCrash(this.consecutiveFailures);
      }
    } finally {
      this.probing = false;
    }
  }

  // Isolated Node HTTP probe — see serverReachability.isServerReachable. Kept as
  // a thin method so the tick logic stays readable and testable.
  private check(): Promise<boolean> {
    return isServerReachable(this.targetUrl, this.timeoutMs);
  }
}

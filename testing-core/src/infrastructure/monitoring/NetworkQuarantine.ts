// Process-wide network-degradation flag (one active run per process, mirroring
// ActiveScenarioTracker). While degraded, the target is unreachable/flaky, so any
// fault caught in the window is environment noise — StabilityMonitor consults this
// to suppress false findings instead of blaming the target app for a dead network.
export class NetworkQuarantine {
  private static degradedSinceMs: number | null = null;
  private static reasonText = '';

  // Enter the degraded window. Returns false (no state change) if already degraded.
  public static beginDegraded(reason: string): boolean {
    if (NetworkQuarantine.degradedSinceMs !== null) return false;
    NetworkQuarantine.degradedSinceMs = Date.now();
    NetworkQuarantine.reasonText = reason;
    return true;
  }

  // Leave the degraded window. Returns false if it was not degraded.
  public static endDegraded(): boolean {
    if (NetworkQuarantine.degradedSinceMs === null) return false;
    NetworkQuarantine.degradedSinceMs = null;
    NetworkQuarantine.reasonText = '';
    return true;
  }

  public static isDegraded(): boolean {
    return NetworkQuarantine.degradedSinceMs !== null;
  }

  public static degradedSince(): number | null {
    return NetworkQuarantine.degradedSinceMs;
  }

  public static currentReason(): string {
    return NetworkQuarantine.reasonText;
  }

  // Clear across runs so a reused worker never inherits a stale degraded window.
  public static reset(): void {
    NetworkQuarantine.degradedSinceMs = null;
    NetworkQuarantine.reasonText = '';
  }
}

/**
 * Session-scoped adaptive throttle for the high-impact RouteTrasher (URL/history)
 * attack. The per-STATE URL-mutation budget (StateGraphNavigator.canRouteMutate)
 * already stops re-trashing ONE state; it cannot stop RouteTrasher firing once on
 * each of many distinct route-owning states and so dominating a MIXED run — every
 * run is ~20 navigations that re-bootstrap the SPA and starve form fuzzing,
 * interaction, and component exploration.
 *
 * This adds two orthogonal session-wide limits consulted alongside the per-state
 * budget: a maximum executions cap and a minimum-interval cooldown. Once either
 * bites, RouteTrasher drops out of the candidate list and the existing scenario
 * fallthrough (form bypass / concurrency / coordinate bombing / plain navigation)
 * takes over — so exploration rebalances without any extra scheduling code.
 *
 * `enabled: false` (a route-focused profile — navigation as the sole active
 * category) bypasses both limits so route manipulation runs unrestricted.
 */
export interface RouteTrashThrottleConfig {
  /** Max RouteTrasher runs per session before throttling off. 0 = unlimited. */
  sessionBudget: number;
  /** Min wall-clock ms between two RouteTrasher runs. 0 = no cooldown. */
  cooldownMs: number;
  /** When false (route-focused profile) both limits are bypassed. */
  enabled: boolean;
  /** Injectable clock — defaults to Date.now (overridden in tests). */
  now?: () => number;
}

export class RouteTrashThrottle {
  private runs = 0;
  private lastRunMs = 0;
  private readonly now: () => number;

  constructor(private readonly config: RouteTrashThrottleConfig) {
    this.now = config.now ?? ((): number => Date.now());
  }

  /** Clear per-session counters so a reused engine instance starts each run fresh. */
  public reset(): void {
    this.runs = 0;
    this.lastRunMs = 0;
  }

  /** Whether RouteTrasher may run right now under the session budget + cooldown. */
  public canRun(): boolean {
    if (!this.config.enabled) return true;
    if (this.config.sessionBudget > 0 && this.runs >= this.config.sessionBudget) return false;
    if (
      this.config.cooldownMs > 0 &&
      this.lastRunMs > 0 &&
      this.now() - this.lastRunMs < this.config.cooldownMs
    ) {
      return false;
    }
    return true;
  }

  /**
   * Account one RouteTrasher run. Returns true only on the run that EXHAUSTS the
   * session budget, so the caller can announce the rebalance exactly once.
   */
  public record(): boolean {
    if (!this.config.enabled) return false;
    this.runs += 1;
    this.lastRunMs = this.now();
    return this.config.sessionBudget > 0 && this.runs === this.config.sessionBudget;
  }
}

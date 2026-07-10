/**
 * RouteExhaustionTracker — consecutive defensive/error-route detector.
 *
 * Complements the graph's URL-aware node identity (see DomHasher `urlAware`).
 * Making `/null` and `/-1` distinct nodes stops the FALSE 3-strike loop, but the
 * engine could still tour a parade of structurally identical error templates as
 * if each were productive. This tracker recognises that pattern from two
 * orthogonal signals observed per step:
 *   • an observed main-frame HTTP status ≥ 400 (a real hard-navigation error), and
 *   • a "route-collapse": the SAME normalized DOM structure re-rendered at a
 *     DIFFERENT normalized route path — the identical-404-template fingerprint.
 * When either recurs for `threshold` consecutive steps the route is declared
 * exhausted, letting the loop penalize + redirect instead of oscillating.
 *
 * Pure and deterministic (no timers, no randomness) so runs stay reproducible.
 */

/** The canonical client/server error boundary — a status at/above this is defensive. */
const DEFENSIVE_STATUS_MIN = 400;

/** Consecutive error-steps before a route branch is declared exhausted. */
const DEFAULT_THRESHOLD = 2;

/** One step's inputs, derived from the URL-aware compound fingerprint. */
export interface RouteStepObservation {
  /** DOM-only structural sub-hash (the shell), independent of the route. */
  structureHash: string;
  /** Normalized route path (`pathname + hash`, query dropped). */
  routePath: string;
  /** Main-frame document status for this route, or null for pure client renders. */
  httpStatus: number | null;
}

/** Verdict for a single observed step. */
export interface RouteExhaustionVerdict {
  /** Whether THIS step is a defensive/error state. */
  isErrorState: boolean;
  /** Length of the current consecutive error-state run (0 when this step is clean). */
  consecutiveErrorStates: number;
  /** True once the consecutive run reaches the threshold — act on this. */
  exhausted: boolean;
  /** Human-readable cause, safe for telemetry. */
  reason: string;
}

export class RouteExhaustionTracker {
  private prevStructureHash = '';
  private prevRoutePath = '';
  private consecutive = 0;
  private hasPrev = false;

  constructor(private readonly threshold: number = DEFAULT_THRESHOLD) {}

  /** Clear all state at the start of a new Safari run. */
  public reset(): void {
    this.prevStructureHash = '';
    this.prevRoutePath = '';
    this.consecutive = 0;
    this.hasPrev = false;
  }

  /** Fold one step into the consecutive-error run and return the verdict. */
  public observe(step: RouteStepObservation): RouteExhaustionVerdict {
    const httpError = step.httpStatus !== null && step.httpStatus >= DEFENSIVE_STATUS_MIN;

    // Route-collapse: the identical structural shell re-rendered at a new route.
    // Needs a prior step to compare against; a same-path repeat is left to the
    // navigator's exact-hash loop detection (identity already covers it).
    const routeCollapse =
      this.hasPrev &&
      step.structureHash !== '' &&
      step.structureHash === this.prevStructureHash &&
      step.routePath !== this.prevRoutePath;

    const isErrorState = httpError || routeCollapse;

    let reason: string;
    if (httpError && routeCollapse) {
      reason = `HTTP ${step.httpStatus} on a repeated error template`;
    } else if (httpError) {
      reason = `HTTP ${step.httpStatus} defensive response`;
    } else if (routeCollapse) {
      reason = `identical template re-rendered at ${step.routePath || '(root)'}`;
    } else {
      reason = 'no error signal';
    }

    this.consecutive = isErrorState ? this.consecutive + 1 : 0;

    this.prevStructureHash = step.structureHash;
    this.prevRoutePath = step.routePath;
    this.hasPrev = true;

    return {
      isErrorState,
      consecutiveErrorStates: this.consecutive,
      exhausted: this.consecutive >= this.threshold,
      reason,
    };
  }
}

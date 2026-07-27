/**
 * RouteExhaustionTracker — defensive/error-route detector.
 *
 * Complements the graph's URL-aware node identity (see DomHasher `urlAware`).
 * Making `/null` and `/-1` distinct nodes stops the FALSE 3-strike loop, but the
 * engine could still tour a parade of structurally identical error templates as
 * if each were productive. This tracker recognises that pattern from two signals
 * of DELIBERATELY different confidence:
 *
 *   • HARD — an observed main-frame HTTP status ≥400. Corroborated by the server;
 *     acted on at the first occurrence.
 *   • SOFT — a "route-collapse": the SAME normalized DOM structure re-rendered at
 *     a DIFFERENT normalized route path. On data-driven SPAs this ALSO describes
 *     legitimate master-detail navigation (`/products/1` → `/products/2`), which
 *     the structure hash deliberately normalizes into one shell. It therefore
 *     needs corroboration before it may exclude a state:
 *       - a main-frame status the server explicitly served (2xx/3xx) vetoes it
 *         outright — that route exists;
 *       - the run must span routes never yet seen in it, so an A→B→A oscillation
 *         (a nav anchor and the page it returns to) is a navigable pair, not a
 *         parade — returning to a route already in the run RESETS it;
 *       - and it must then recur for `collapseThreshold` CONSECUTIVE steps
 *         (default 2 ⇒ three identical shells across three distinct routes).
 *
 * `isErrorState` is the single actionable verdict — the hysteresis is applied
 * inside, so consumers never re-derive it and no threshold can go unread.
 *
 * Pure and deterministic (no timers, no randomness) so runs stay reproducible.
 */

/** The canonical client/server error boundary — a status at/above this is defensive. */
const DEFENSIVE_STATUS_MIN = 400;

/** Consecutive route-collapses required before the soft signal may exclude a state. */
const DEFAULT_COLLAPSE_THRESHOLD = 2;

/** One step's inputs, derived from the URL-aware compound fingerprint. */
export interface RouteStepObservation {
  /** DOM-only structural sub-hash (the shell), independent of the route. */
  structureHash: string;
  /** Normalized route path (`pathname + hash`, query dropped). */
  routePath: string;
  /** Main-frame document status for this route, or null for pure client renders. */
  httpStatus: number | null;
}

/** Which signal produced the verdict. */
export type RouteErrorSignal = 'none' | 'http-error' | 'route-collapse';

/** Verdict for a single observed step. */
export interface RouteExhaustionVerdict {
  /** Whether this step must be excluded from the graph as an error state. */
  isErrorState: boolean;
  /** The signal that decided the verdict. */
  signal: RouteErrorSignal;
  /** Length of the current consecutive route-collapse run (0 when this step is clean). */
  consecutiveCollapses: number;
  /** Human-readable cause, safe for telemetry. */
  reason: string;
}

export class RouteExhaustionTracker {
  private prevStructureHash = '';
  private prevRoutePath = '';
  private consecutiveCollapses = 0;
  private hasPrev = false;
  // Routes spanned by the collapse run in progress. A parade of error templates
  // keeps landing on NEW routes; an oscillation revisits one already in the run.
  private readonly collapseRoutes = new Set<string>();

  constructor(private readonly collapseThreshold: number = DEFAULT_COLLAPSE_THRESHOLD) {}

  /** Clear all state at the start of a new Safari run. */
  public reset(): void {
    this.prevStructureHash = '';
    this.prevRoutePath = '';
    this.consecutiveCollapses = 0;
    this.hasPrev = false;
    this.collapseRoutes.clear();
  }

  /** Fold one step into the collapse run and return the verdict. */
  public observe(step: RouteStepObservation): RouteExhaustionVerdict {
    const httpError = step.httpStatus !== null && step.httpStatus >= DEFENSIVE_STATUS_MIN;
    // A status the server actually served for THIS route proves the route exists.
    const servedOk = step.httpStatus !== null && !httpError;

    // Route-collapse: the identical structural shell re-rendered at a new route.
    // Needs a prior step to compare against; a same-path repeat is left to the
    // navigator's exact-hash loop detection (identity already covers it).
    const collapse =
      this.hasPrev &&
      !servedOk &&
      step.structureHash !== '' &&
      step.structureHash === this.prevStructureHash &&
      step.routePath !== this.prevRoutePath;

    // Returning to a route the run already spans proves the pair is navigable
    // (a nav anchor and the page it comes back to), so the run restarts here.
    if (collapse && !this.collapseRoutes.has(step.routePath)) {
      if (this.consecutiveCollapses === 0) this.collapseRoutes.add(this.prevRoutePath);
      this.collapseRoutes.add(step.routePath);
      this.consecutiveCollapses += 1;
    } else {
      this.consecutiveCollapses = 0;
      this.collapseRoutes.clear();
    }
    const collapseConfirmed = this.consecutiveCollapses >= this.collapseThreshold;

    this.prevStructureHash = step.structureHash;
    this.prevRoutePath = step.routePath;
    this.hasPrev = true;

    if (httpError) {
      return this.verdict(true, 'http-error', `HTTP ${step.httpStatus} defensive response`);
    }
    if (collapseConfirmed) {
      return this.verdict(
        true,
        'route-collapse',
        `identical template re-rendered across ${this.consecutiveCollapses + 1} consecutive routes (latest ${step.routePath || '(root)'})`,
      );
    }
    return this.verdict(
      false,
      'none',
      collapse
        ? `same shell at ${step.routePath || '(root)'} — tolerated pending corroboration`
        : 'no error signal',
    );
  }

  private verdict(isErrorState: boolean, signal: RouteErrorSignal, reason: string): RouteExhaustionVerdict {
    return { isErrorState, signal, consecutiveCollapses: this.consecutiveCollapses, reason };
  }
}

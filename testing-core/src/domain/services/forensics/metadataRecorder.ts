import type { RouteTrashMetadata, StressClickMetadata } from '../../chaos/index.js';

/**
 * Shared base for scenario metadata recorders.
 *
 * Every recorder mutates, IN PLACE, the same metadata object that was handed to
 * `chaosManager.startTransaction(...)` — `getActiveMetadata()` returns it by
 * reference, so the live transaction, telemetry, and any stored finding all
 * observe one consistent, reproducible record. The base owns that by-reference
 * commit (`patch`) so subclasses only declare which fields each step touches.
 */
export abstract class MetadataRecorder<T extends object> {
  constructor(protected readonly metadata: T) {}

  /** Merge a partial update into the live metadata object (mutates by reference). */
  protected patch(fields: Partial<T>): void {
    Object.assign(this.metadata, fields);
  }
}

// ─────────────────────────────────────────────────────────────
// Concurrent-stress (STRESS_CLICK)
// ─────────────────────────────────────────────────────────────

type StressResultingState = NonNullable<StressClickMetadata['resultingState']>;

/** Outcome of a zero-wait burst — `ConcurrentBurstResult` satisfies this structurally. */
export interface BurstOutcome {
  selectors: string[];
  attempted: number;
  completed: number;
  durationMs: number;
  executionOrder: number[];
  resultingState: StressResultingState;
}

/** Folds a completed concurrent burst into the shared `StressClickMetadata`. */
export class StressClickMetadataRecorder extends MetadataRecorder<StressClickMetadata> {
  public record(result: BurstOutcome): void {
    this.patch({
      elementChain: [...result.selectors],
      targetSelector: result.selectors[0] ?? this.metadata.targetSelector,
      clickCount: result.attempted,
      completed: result.completed,
      durationMs: result.durationMs,
      executionOrder: [...result.executionOrder],
      resultingState: result.resultingState,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Route trashing (ROUTE_TRASH)
// ─────────────────────────────────────────────────────────────

type NavigationType = NonNullable<RouteTrashMetadata['navigationType']>;
type RouteResultingState = NonNullable<RouteTrashMetadata['resultingState']>;

/**
 * Accumulates deterministic execution metadata for a single route-trash run:
 * a running history-depth offset and the ordered, de-duplicated visited routes.
 */
export class RouteTrashMetadataRecorder extends MetadataRecorder<RouteTrashMetadata> {
  private currentHistoryIndex = 0;
  private readonly visited: string[];

  constructor(metadata: RouteTrashMetadata) {
    super(metadata);
    this.visited = metadata.visitedRoutes ? [...metadata.visitedRoutes] : [];
    this.visit(metadata.originPath);
  }

  /** Running history-depth offset relative to origin (negative = back). */
  public get historyIndex(): number {
    return this.currentHistoryIndex;
  }

  /** Record a completed navigation/mutation step into the shared metadata. */
  public record(navigationType: NavigationType, url: string): void {
    if (navigationType === 'history_back') {
      this.currentHistoryIndex -= 1;
    } else if (navigationType === 'history_forward') {
      this.currentHistoryIndex += 1;
    }
    this.visit(url);

    this.patch({
      navigationType,
      injectedPath: url,
      targetPath: url,
      historyIndex: this.currentHistoryIndex,
      visitedRoutes: [...this.visited],
    });
  }

  /** Stamp the terminal state once the bursts and origin-restore complete. */
  public finalize(state: RouteResultingState, finalUrl: string): void {
    this.visit(finalUrl);
    this.patch({
      resultingState: state,
      visitedRoutes: [...this.visited],
    });
  }

  private visit(url: string): void {
    if (url && this.visited[this.visited.length - 1] !== url) {
      this.visited.push(url);
    }
  }
}

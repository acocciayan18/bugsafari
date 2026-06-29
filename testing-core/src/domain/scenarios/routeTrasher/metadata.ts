import type { RouteTrashMetadata } from '../../fuzzing/index.js';

/**
 * The summary returned to the engine after a route-trash run. Cycle-aware:
 * `returnedToOrigin` signals whether the bursts net-landed back on the origin
 * path, `finalUrl` is where the page rests after origin-restore.
 */
export interface RouteTrashResult {
  attempted: number;
  completed: number;
  finalUrl: string;
  returnedToOrigin: boolean;
}

type NavigationType = NonNullable<RouteTrashMetadata['navigationType']>;
type ResultingState = NonNullable<RouteTrashMetadata['resultingState']>;

/**
 * Accumulates deterministic execution metadata for a single route-trash run.
 *
 * It mutates the same `RouteTrashMetadata` object that was handed to
 * `chaosManager.startTransaction(...)`, which `getActiveMetadata()` returns by
 * reference — so the live transaction, telemetry, and any stored finding all
 * observe one consistent, reproducible record (repetitions, running history
 * index, visited routes, resulting state).
 */
export class RouteTrashMetadataRecorder {
  private currentHistoryIndex = 0;
  private readonly visited: string[];

  constructor(private readonly metadata: RouteTrashMetadata) {
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

    this.metadata.navigationType = navigationType;
    this.metadata.injectedPath = url;
    this.metadata.targetPath = url;
    this.metadata.historyIndex = this.currentHistoryIndex;
    this.metadata.visitedRoutes = [...this.visited];
  }

  /** Stamp the terminal state once the bursts and origin-restore complete. */
  public finalize(state: ResultingState, finalUrl: string): void {
    this.visit(finalUrl);
    this.metadata.resultingState = state;
    this.metadata.visitedRoutes = [...this.visited];
  }

  private visit(url: string): void {
    if (url && this.visited[this.visited.length - 1] !== url) {
      this.visited.push(url);
    }
  }
}

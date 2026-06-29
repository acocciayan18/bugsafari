import type { StressClickMetadata } from '../../fuzzing/index.js';
import type { ConcurrentBurstResult } from './concurrentBurst.js';

type ResultingState = NonNullable<StressClickMetadata['resultingState']>;

/**
 * Accumulates deterministic execution metadata for a single concurrent-stress
 * burst.
 *
 * It mutates the same `StressClickMetadata` object that was handed to
 * `chaosManager.startTransaction(...)`, which `getActiveMetadata()` returns by
 * reference — so the live transaction, telemetry, and any stored finding all
 * observe one consistent, reproducible record (click count, completed, duration,
 * settle order, resulting state).
 */
export class StressClickMetadataRecorder {
  constructor(private readonly metadata: StressClickMetadata) {}

  /** Fold a completed burst's outcome into the shared metadata. */
  public record(result: ConcurrentBurstResult): void {
    this.metadata.elementChain = [...result.selectors];
    this.metadata.targetSelector = result.selectors[0] ?? this.metadata.targetSelector;
    this.metadata.clickCount = result.attempted;
    this.metadata.completed = result.completed;
    this.metadata.durationMs = result.durationMs;
    this.metadata.executionOrder = [...result.executionOrder];
    this.metadata.resultingState = result.resultingState as ResultingState;
  }
}

/** Build the human-readable reproduction step for a burst (for the snapshot). */
export function describeBurst(
  result: ConcurrentBurstResult,
  label: string,
  kind: string,
): string {
  return (
    `Concurrent zero-wait burst: ${result.attempted} clicks on ${kind} "${label}" ` +
    `→ ${result.completed}/${result.attempted} completed in ${result.durationMs}ms`
  );
}

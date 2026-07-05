import type { Page } from 'playwright';
import { attachAnomalyListeners, type ApiResponseTrace, type ConsoleAnomaly } from './anomalyListeners.js';

/**
 * Fuzz-step forensic auditing.
 *
 * Captures a comprehensive, immutable execution snapshot around every payload
 * injection so a run can be replayed and analyzed after the fact: the DOM state
 * hash before and after the action, any API responses the payload provoked, and
 * console/page-error anomalies observed during the step. Snapshots are frozen on
 * persist and the store is append-only, so recorded evidence can never be
 * mutated by later steps.
 */

// Re-export the shared anomaly shapes so existing importers of this module keep working.
export type { ApiResponseTrace, ConsoleAnomaly };

/** Immutable record of one payload injection and its observed effects. */
export interface FuzzStepSnapshot {
  readonly stepId: number;
  readonly selector: string;
  readonly category: string;
  readonly strategy: string;
  readonly escalationLevel: number;
  readonly payload: string;
  readonly payloadLength: number;
  readonly preStateHash: string;
  readonly postStateHash: string;
  /** True when the injection produced a meaningful application reaction. */
  readonly stateChanged: boolean;
  readonly apiResponses: ReadonlyArray<ApiResponseTrace>;
  readonly consoleAnomalies: ReadonlyArray<ConsoleAnomaly>;
  readonly timestamp: string;
}

/** Metadata describing the payload about to be injected. */
export interface FuzzStepMeta {
  selector: string;
  category: string;
  strategy: string;
  escalationLevel: number;
  payload: string;
}

// Settle window (ms) after injection during which late API responses / console
// errors are still attributed to this step before the post-hash is taken.
const SETTLE_MS = 400;

/**
 * Append-only, immutable store of fuzz-step snapshots for the active run.
 * Mirrors the ReproductionPlaybookStore pattern (static, bounded, snapshot()).
 */
export class FuzzForensicLog {
  private static steps: FuzzStepSnapshot[] = [];
  private static readonly capacity = 500;
  private static counter = 0;

  /** Clear the log at the start of a new Safari run. */
  public static reset(): void {
    FuzzForensicLog.steps = [];
    FuzzForensicLog.counter = 0;
  }

  /** Persist a snapshot. It is deep-frozen here and never mutated afterward. */
  public static record(snapshot: FuzzStepSnapshot): FuzzStepSnapshot {
    const frozen = freezeSnapshot(snapshot);
    FuzzForensicLog.steps.push(frozen);
    while (FuzzForensicLog.steps.length > FuzzForensicLog.capacity) {
      FuzzForensicLog.steps.shift();
    }
    return frozen;
  }

  /** Monotonic step id for the next snapshot. */
  public static nextStepId(): number {
    return ++FuzzForensicLog.counter;
  }

  /** Immutable view of all recorded snapshots (already frozen). */
  public static snapshot(): ReadonlyArray<FuzzStepSnapshot> {
    return [...FuzzForensicLog.steps];
  }

  /** Total snapshots recorded (post-eviction count). */
  public static size(): number {
    return FuzzForensicLog.steps.length;
  }
}

/** Deep-freeze a snapshot and its nested arrays so it is truly immutable. */
function freezeSnapshot(s: FuzzStepSnapshot): FuzzStepSnapshot {
  s.apiResponses.forEach((r) => Object.freeze(r));
  s.consoleAnomalies.forEach((a) => Object.freeze(a));
  Object.freeze(s.apiResponses);
  Object.freeze(s.consoleAnomalies);
  return Object.freeze(s);
}

/** A meaningful reaction = DOM state moved, OR the backend answered, OR the app errored. */
function computeStateChanged(
  preHash: string,
  postHash: string,
  apiResponses: ReadonlyArray<ApiResponseTrace>,
  consoleAnomalies: ReadonlyArray<ConsoleAnomaly>,
): boolean {
  return preHash !== postHash || apiResponses.length > 0 || consoleAnomalies.length > 0;
}

/**
 * Synchronously capture a full forensic snapshot around a single injection.
 *
 * Ordering is strict and awaited so the record is a faithful before/after pair:
 *   1. attach response/console/pageerror listeners
 *   2. capture pre-action DOM hash
 *   3. run the injection (inject + submit)
 *   4. settle, then capture post-action DOM hash
 *   5. detach listeners, build → freeze → persist the snapshot
 *
 * Never throws: a hashing or injection failure still yields a persisted snapshot
 * (with whatever was observed), so forensic coverage has no gaps.
 *
 * @param page      Playwright page under test.
 * @param hashPage  DOM state-hash function (injected to avoid a hard ml/ dep).
 * @param meta      Payload metadata for this step.
 * @param injectFn  Performs the actual constraint-bypass + injection + submit.
 */
export async function captureFuzzStep(
  page: Page,
  hashPage: (page: Page) => Promise<string>,
  meta: FuzzStepMeta,
  injectFn: () => Promise<void>,
): Promise<FuzzStepSnapshot> {
  const { apiResponses, consoleAnomalies, detach } = attachAnomalyListeners(page);

  const safeHash = async (): Promise<string> => {
    try {
      return await hashPage(page);
    } catch {
      return '';
    }
  };

  let preStateHash = '';
  let postStateHash = '';
  try {
    preStateHash = await safeHash();
    try {
      await injectFn();
    } catch {
      // Injection errors (detached node, OOM) are themselves signal; the snapshot
      // still records the attempt and any anomalies the crash produced.
    }
    // Give late XHR/fetch + error events a bounded window to arrive.
    await page.waitForTimeout(SETTLE_MS).catch(() => undefined);
    postStateHash = await safeHash();
  } finally {
    detach();
  }

  const stateChanged = computeStateChanged(preStateHash, postStateHash, apiResponses, consoleAnomalies);

  return FuzzForensicLog.record({
    stepId: FuzzForensicLog.nextStepId(),
    selector: meta.selector,
    category: meta.category,
    strategy: meta.strategy,
    escalationLevel: meta.escalationLevel,
    payload: meta.payload,
    payloadLength: meta.payload.length,
    preStateHash,
    postStateHash,
    stateChanged,
    apiResponses,
    consoleAnomalies,
    timestamp: new Date().toISOString(),
  });
}

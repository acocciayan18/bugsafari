import type { Page } from 'playwright';
import { attachAnomalyListeners, type ApiResponseTrace, type ConsoleAnomaly } from './anomalyListeners.js';

/**
 * Navigation-step forensic auditing.
 *
 * Parallel to {@link fuzzForensics} but for the RouteTrasher: captures a
 * comprehensive, immutable snapshot around every navigation action — the DOM
 * state hash and client-side route state before and after, any API responses the
 * transition provoked, console/page-error anomalies, and how long it took.
 * Snapshots are deep-frozen on persist and the store is append-only, so recorded
 * navigation evidence can never be mutated by later steps.
 *
 * The two anomaly shapes are shared with {@link fuzzForensics} to avoid drift.
 */

// Settle window (ms) after the navigation during which late API responses /
// console errors are still attributed to this step before the post-hash is taken.
const SETTLE_MS = 400;

/** Metadata describing the navigation about to be performed. */
export interface NavStepMeta {
  navigationType: string;
  fromUrl: string;
  /** The URL the step intended to reach (for goto-style steps); optional for history/hash. */
  intendedUrl?: string;
}

/** Immutable record of one navigation action and its observed effects. */
export interface NavStepSnapshot {
  readonly stepId: number;
  readonly navigationType: string;
  readonly fromUrl: string;
  readonly toUrl: string;
  /** Serialized client-side route state after the step (pathname/hash/search/history). */
  readonly routeState: string;
  readonly preStateHash: string;
  readonly postStateHash: string;
  readonly urlChanged: boolean;
  readonly domChanged: boolean;
  /** The mandated inconsistency: the URL moved but the DOM did not update to match. */
  readonly urlChangedWithoutDom: boolean;
  /** Wall-clock duration of the navigation + settle window, in ms. */
  readonly navDurationMs: number;
  readonly apiResponses: ReadonlyArray<ApiResponseTrace>;
  readonly consoleAnomalies: ReadonlyArray<ConsoleAnomaly>;
  readonly timestamp: string;
}

/**
 * Append-only, immutable store of navigation-step snapshots for the active run.
 * Mirrors the FuzzForensicLog / ReproductionPlaybookStore pattern.
 */
export class NavForensicLog {
  private static steps: NavStepSnapshot[] = [];
  private static readonly capacity = 500;
  private static counter = 0;

  /** Clear the log at the start of a new Safari run. */
  public static reset(): void {
    NavForensicLog.steps = [];
    NavForensicLog.counter = 0;
  }

  /** Persist a snapshot. It is deep-frozen here and never mutated afterward. */
  public static record(snapshot: NavStepSnapshot): NavStepSnapshot {
    const frozen = freezeSnapshot(snapshot);
    NavForensicLog.steps.push(frozen);
    while (NavForensicLog.steps.length > NavForensicLog.capacity) {
      NavForensicLog.steps.shift();
    }
    return frozen;
  }

  /** Monotonic step id for the next snapshot. */
  public static nextStepId(): number {
    return ++NavForensicLog.counter;
  }

  /** Immutable view of all recorded snapshots (already frozen). */
  public static snapshot(): ReadonlyArray<NavStepSnapshot> {
    return [...NavForensicLog.steps];
  }

  /** Total snapshots recorded (post-eviction count). */
  public static size(): number {
    return NavForensicLog.steps.length;
  }
}

/** Deep-freeze a snapshot and its nested arrays so it is truly immutable. */
function freezeSnapshot(s: NavStepSnapshot): NavStepSnapshot {
  s.apiResponses.forEach((r) => Object.freeze(r));
  s.consoleAnomalies.forEach((a) => Object.freeze(a));
  Object.freeze(s.apiResponses);
  Object.freeze(s.consoleAnomalies);
  return Object.freeze(s);
}

/** Read the client-side route state without ever throwing. */
async function readRouteState(page: Page): Promise<string> {
  try {
    return await page.evaluate(() =>
      JSON.stringify({
        pathname: location.pathname,
        hash: location.hash,
        search: location.search,
        historyLength: history.length,
        historyState: history.state ?? null,
      }),
    );
  } catch {
    return '';
  }
}

/**
 * Synchronously capture a full forensic snapshot around a single navigation.
 *
 * Ordering is strict and awaited so the record is a faithful before/after pair:
 *   1. attach response/console/pageerror listeners
 *   2. capture pre-action URL + DOM hash
 *   3. run the navigation
 *   4. settle, then capture post-action URL + DOM hash + route state
 *   5. detach listeners, build → freeze → persist the snapshot
 *
 * Never throws: a hashing or navigation failure still yields a persisted snapshot
 * (with whatever was observed), so forensic coverage has no gaps.
 *
 * @param page      Playwright page under test.
 * @param hashPage  DOM state-hash function (injected to avoid a hard ml/ dep).
 * @param meta      Navigation metadata for this step.
 * @param navFn     Performs the actual navigation action.
 */
export async function captureNavStep(
  page: Page,
  hashPage: (page: Page) => Promise<string>,
  meta: NavStepMeta,
  navFn: () => Promise<void>,
): Promise<NavStepSnapshot> {
  const { apiResponses, consoleAnomalies, detach } = attachAnomalyListeners(page);

  const safeHash = async (): Promise<string> => {
    try {
      return await hashPage(page);
    } catch {
      return '';
    }
  };

  const fromUrl = meta.fromUrl || page.url();
  let toUrl = fromUrl;
  let routeState = '';
  let preStateHash = '';
  let postStateHash = '';
  const t0 = Date.now();
  try {
    preStateHash = await safeHash();
    try {
      await navFn();
    } catch {
      // Navigation errors (interrupted transition, teardown race) are themselves
      // signal; the snapshot still records the attempt and any anomalies produced.
    }
    // Give late XHR/fetch + error events a bounded window to arrive.
    await page.waitForTimeout(SETTLE_MS).catch(() => undefined);
    toUrl = page.url();
    postStateHash = await safeHash();
    routeState = await readRouteState(page);
  } finally {
    detach();
  }

  const navDurationMs = Date.now() - t0;
  const urlChanged = fromUrl !== toUrl;
  const domChanged = preStateHash !== postStateHash;
  const urlChangedWithoutDom = urlChanged && !domChanged;

  return NavForensicLog.record({
    stepId: NavForensicLog.nextStepId(),
    navigationType: meta.navigationType,
    fromUrl,
    toUrl,
    routeState,
    preStateHash,
    postStateHash,
    urlChanged,
    domChanged,
    urlChangedWithoutDom,
    navDurationMs,
    apiResponses,
    consoleAnomalies,
    timestamp: new Date().toISOString(),
  });
}

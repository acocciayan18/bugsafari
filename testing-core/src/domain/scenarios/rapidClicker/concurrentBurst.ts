/**
 * Concurrent Burst — the single true zero-wait click primitive.
 *
 * Every concurrent-stress path in the engine routes through here so there is
 * exactly one concurrency implementation. It fires every click in a tight
 * synchronous loop with NO inter-click `await` (zero-wait flood), then settles
 * them together with `Promise.allSettled`. This is what actually pressures the
 * SPA event loop hard enough to surface race conditions and async state
 * conflicts — sequential `await page.click()` cannot.
 *
 * It also captures deterministic execution metadata (attempted, completed,
 * duration, and the order in which clicks settled) so telemetry, the live
 * transaction, and any stored finding observe one consistent record.
 */

import type { Page } from 'playwright';
import { isNonFatalNavigationError, isObscuredOrDetached } from './utils.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[ConcurrentBurst]');

/** Where the burst ended up once all clicks settled. */
export type BurstResultingState = 'all-completed' | 'partial' | 'error';

/** Rich, deterministic outcome of a single zero-wait burst. */
export interface ConcurrentBurstResult {
  /** Selectors that were clicked, in submission order (one entry per click). */
  selectors: string[];
  /** Total clicks fired. */
  attempted: number;
  /** Clicks that landed without a fatal error. */
  completed: number;
  /** Wall-clock duration of the burst in milliseconds. */
  durationMs: number;
  /** Click indices in the order their promises settled (concurrency fingerprint). */
  executionOrder: number[];
  /** Terminal state derived from completed vs attempted. */
  resultingState: BurstResultingState;
}

export interface ConcurrentBurstOptions {
  /** Per-click timeout in ms (default 1000). */
  timeout?: number;
  /** Bypass actionability checks to maximise event-loop pressure (default true). */
  force?: boolean;
}

/**
 * Fire every selector in `targets` as a concurrent, zero-wait burst. Pass the
 * same selector N times to hammer one element N times, or N distinct selectors
 * to click siblings simultaneously. Non-fatal navigation/detachment errors are
 * swallowed per-click so one bad target never aborts the burst.
 */
export async function executeConcurrentBurst(
  page: Page,
  targets: string[],
  options?: ConcurrentBurstOptions,
): Promise<ConcurrentBurstResult> {
  const timeout = options?.timeout ?? 1000;
  const force = options?.force ?? true;

  const executionOrder: number[] = [];
  const start = Date.now();

  // Build ALL click promises in one synchronous pass — no `await` in the loop,
  // so every click is in flight before the first one resolves (zero-wait flood).
  const tasks = targets.map((selector, index) =>
    page
      .click(selector, { force, noWaitAfter: true, timeout })
      .then(() => {
        executionOrder.push(index);
        return true;
      })
      .catch((error: Error) => {
        executionOrder.push(index);
        // Obscured/detached targets and mid-flight navigation are expected under
        // a concurrent flood — swallow quietly; surface anything unexpected.
        if (!isNonFatalNavigationError(error) && !isObscuredOrDetached(error)) {
          obsLog.error(
            `[ConcurrentBurst] Non-fatal error on click ${index + 1}/${targets.length} (${selector}): ${error.message}`,
          );
        }
        return false;
      }),
  );

  const settled = await Promise.allSettled(tasks);
  const completed = settled.filter(
    (result) => result.status === 'fulfilled' && result.value === true,
  ).length;
  const durationMs = Date.now() - start;

  const resultingState: BurstResultingState =
    completed === targets.length ? 'all-completed' : completed === 0 ? 'error' : 'partial';

  return {
    selectors: targets,
    attempted: targets.length,
    completed,
    durationMs,
    executionOrder,
    resultingState,
  };
}

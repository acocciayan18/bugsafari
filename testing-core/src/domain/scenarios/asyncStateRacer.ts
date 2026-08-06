/**
 * Async State Racer — SPA asynchronous-lifecycle & interruption-race scenario.
 *
 * Complements the existing arsenal (which floods clicks, mutates routes, or injects
 * payloads) by attacking the ASYNC dimension nothing else targets: the window while
 * a request/transition is IN FLIGHT. For a control that kicks off async work it:
 *
 *   1. Bridges the page's `unhandledrejection` events into `console.error`, so the
 *      always-on console monitor classifies swallowed async failures the SPA never
 *      handled (aborted fetches, dangling promises) as runtime faults.
 *   2. Fires the async action, then — a sub-round-trip delay later, while the request
 *      is still in flight — interrupts it (Escape + a concurrent re-trigger). This is
 *      a user-equivalent "cancel/double-submit" that provokes teardown races,
 *      setState-after-unmount, stale-closure state, and duplicate writes.
 *   3. Samples DOM-node count and JS heap before/after as a coarse lifecycle-churn /
 *      leak signal recorded on the transaction (diagnostic only — never a finding by
 *      itself; real faults surface through the console/network/pageerror monitors).
 *
 * Integration is by provocation, not self-assertion: findings emerge from the same
 * three-tier StabilityMonitor + FaultClassifier pipeline every scenario uses, and are
 * attributed to this scenario via the ActiveScenarioTracker window opened around it.
 * Every browser call is guarded so a detached/closed page never throws — the scenario
 * is confined (no cross-origin navigation), bounded, and deterministic.
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../entities/InteractiveElement.js';
import type { ChaosTransactionManager, AsyncRaceMetadata } from '../chaos/index.js';
import { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel, elementNoun, describeTarget } from '../services/forensics/narration.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[BugSafari]');

/** Bounded number of interruption cycles — deterministic and efficient. */
const RACE_CYCLES = 3;
/** Delay between the async trigger and the interrupt: sits inside the in-flight window. */
const INTERRUPT_DELAY_MS = 45;
/** Per-cycle settle window so each interrupted operation resolves before the next. */
const SETTLE_MS = 200;
/** Default target when the scenario runs without a specific element. */
const DEFAULT_SELECTOR = 'button, [role="button"], input[type="submit"], input[type="button"]';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Install a one-shot bridge that forwards unhandled promise rejections to the
 * console (idempotent per page). A rejection reaching this handler means the SPA
 * failed to catch it — exactly the async-resilience defect this scenario hunts.
 */
async function installRejectionBridge(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const w = window as unknown as { __bugsafariAsyncBridge?: boolean; __bugsafariRejections?: number };
      if (w.__bugsafariAsyncBridge) return;
      w.__bugsafariAsyncBridge = true;
      w.__bugsafariRejections = 0;
      window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        w.__bugsafariRejections = (w.__bugsafariRejections ?? 0) + 1;
        const reason =
          event && event.reason
            ? ((event.reason as { message?: string }).message ?? String(event.reason))
            : 'unknown';
        console.error('[BugSafari] Unhandled async rejection during interruption race: ' + reason);
      });
    })
    .catch(() => undefined);
}

/** Sample coarse lifecycle metrics; heap is 0 unless Chromium exposes performance.memory. */
async function sampleLifecycle(page: Page): Promise<{ nodes: number; heap: number }> {
  return page
    .evaluate(() => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        nodes: document.querySelectorAll('*').length,
        heap: mem ? mem.usedJSHeapSize : 0,
      };
    })
    .catch(() => ({ nodes: 0, heap: 0 }));
}

/** Read the count of unhandled rejections the bridge captured during the race. */
async function readRejections(page: Page): Promise<number> {
  return page
    .evaluate(() => (window as unknown as { __bugsafariRejections?: number }).__bugsafariRejections ?? 0)
    .catch(() => 0);
}

export const asyncStateRacer = {
  name: 'AsyncStateRacer',

  async execute(
    page: Page,
    target?: InteractiveElement,
    chaosManager?: ChaosTransactionManager<AsyncRaceMetadata> | null,
    isCascading?: () => boolean,
  ): Promise<void> {
    if (page.isClosed()) return;

    const selector = target?.selector ?? DEFAULT_SELECTOR;
    const label = target ? resolveElementLabel(target) : 'async control';

    obsLog.info(`[StressScenario:AsyncStateRacer] Interruption race on '${selector}' (${RACE_CYCLES} cycles)`);

    // 1) Surface swallowed async failures for the always-on console monitor.
    await installRejectionBridge(page);

    // 2) Baseline lifecycle sample. The rejection counter is cumulative per page
    // (the bridge installs once), so this race's count is a DELTA — reading the
    // raw total re-reported every earlier race's rejections as if they were new.
    const baseline = await sampleLifecycle(page);
    const rejectionsBefore = await readRejections(page);

    // The same metadata object is exposed by reference via getActiveMetadata(), so
    // the post-race mutations below flow straight into the live transaction.
    const metadata: AsyncRaceMetadata = {
      targetSelector: selector,
      cycles: RACE_CYCLES,
      interruptDelayMs: INTERRUPT_DELAY_MS,
      interruptMode: 'escape+concurrent-retrigger',
      unhandledRejections: 0,
      heapGrowthBytes: 0,
      nodeGrowth: 0,
      resultingState: 'settled',
    };

    const manager = chaosManager ?? null;
    manager?.startTransaction(selector, 'ASYNC_RACE', metadata);
    ActiveScenarioTracker.record(`Bridge unhandled promise rejections on "${label}" to the console monitor.`);

    try {
      for (let cycle = 0; cycle < RACE_CYCLES; cycle++) {
        if (page.isClosed()) break;

        // Back off mid-race on a failure burst — this scenario's own traffic can tip it over.
        if (isCascading?.()) {
          ActiveScenarioTracker.record(
            `Aborted remaining interruption cycles on "${label}" after cycle ${cycle}/${RACE_CYCLES} — network failure cascade detected.`,
          );
          break;
        }

        // a) Trigger the async action WITHOUT awaiting settle — the request goes in flight.
        //    noWaitAfter so Playwright does not block on a resulting navigation.
        void page.click(selector, { timeout: 800, noWaitAfter: true }).catch(() => undefined);

        // b) Interrupt mid-flight (user-equivalent cancel + double-submit): Escape to
        //    close a modal/route, then a concurrent forced re-trigger. Hits the teardown
        //    and in-flight windows without leaving the page (confinement-safe).
        await wait(INTERRUPT_DELAY_MS);
        await page.keyboard.press('Escape').catch(() => undefined);
        void page.click(selector, { timeout: 800, noWaitAfter: true, force: true }).catch(() => undefined);

        await wait(SETTLE_MS);
      }
    } finally {
      // 3) Post-race lifecycle deltas → recorded on the transaction as diagnostics.
      const after = await sampleLifecycle(page);
      // A navigation mid-race resets the page counter — clamp so the delta never
      // goes negative and reads as a nonsensical "-3 unhandled errors".
      const rejections = Math.max(0, (await readRejections(page)) - rejectionsBefore);
      const stillPresent = target
        ? await page.$(selector).then((el) => el !== null).catch(() => false)
        : true;

      metadata.unhandledRejections = rejections;
      metadata.heapGrowthBytes = Math.max(0, after.heap - baseline.heap);
      metadata.nodeGrowth = after.nodes - baseline.nodes;
      metadata.resultingState = page.isClosed() ? 'error' : stillPresent ? 'settled' : 'detached';

      // Record the race as ONE reproduction step so the 20-slot playbook is not flooded.
      const raceTarget = describeTarget(label, elementNoun(target?.tagName, target?.type));
      ActionRecorder.recordStep({
        actionType: 'CLICK',
        humanIdentifier: label,
        elementKind: elementNoun(target?.tagName, target?.type),
        selector,
        url: page.url(),
        repeatCount: RACE_CYCLES,
      });
      ActiveScenarioTracker.record(
        `Click ${raceTarget} and press Escape ${INTERRUPT_DELAY_MS}ms later while it is still working, ` +
          `then click it again immediately — repeated ${RACE_CYCLES} times; ` +
          `saw ${rejections} unhandled error(s), memory grew ${metadata.heapGrowthBytes} bytes, ` +
          `${metadata.nodeGrowth} extra page elements left behind, ended '${metadata.resultingState}'.`,
      );

      obsLog.info(
        `[StressScenario:AsyncStateRacer] Completed: rejections=${rejections}, ` +
          `heapΔ=${metadata.heapGrowthBytes}B, nodeΔ=${metadata.nodeGrowth}, state=${metadata.resultingState}`,
      );

      manager?.endTransaction();
    }
  },
};

export type AsyncStateRacer = typeof asyncStateRacer;

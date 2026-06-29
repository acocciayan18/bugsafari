/**
 * Button Spammer Stress Scenario
 *
 * Fires CLICK_COUNT clicks at the target element as a single true zero-wait
 * concurrent burst (all clicks in flight before the first resolves), flooding
 * the SPA event loop to surface race conditions, double-submit bugs, and memory
 * leaks in click handlers.
 *
 * It opens a real STRESS_CLICK transaction on the injected ChaosTransactionManager
 * and records deterministic execution metadata (click count, completed, duration,
 * settle order) so telemetry, the live transaction, and stored findings stay
 * consistent and reproducible. The burst is recorded as ONE reproduction step so
 * the immutable failure snapshot reflects the concurrent burst, not 15 entries.
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, StressClickMetadata } from '../../fuzzing/index.js';
import { CLICK_COUNT } from './utils.js';
import { executeConcurrentBurst } from './concurrentBurst.js';
import { StressClickMetadataRecorder, describeBurst } from './metadata.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel, genericElementLabel } from '../../../infrastructure/monitoring/playbookNarrator.js';

export const buttonSpammer = {
  name: 'ButtonSpammer',

  async execute(
    page: Page,
    target?: InteractiveElement,
    chaosManager?: ChaosTransactionManager<StressClickMetadata> | null,
  ): Promise<void> {
    const selector = target?.selector ?? 'button, [role="button"], a';

    console.log(
      `[StressScenario:ButtonSpammer] Starting zero-wait burst of ${CLICK_COUNT} clicks on '${selector}'`,
    );

    // velocity 0 reflects the zero-wait flood (no inter-click delay). The same
    // metadata object is exposed via getActiveMetadata() by reference, so the
    // recorder's mutations flow straight into the live transaction.
    const metadata: StressClickMetadata = {
      velocity: 0,
      elementChain: [selector],
      targetSelector: selector,
      clickCount: CLICK_COUNT,
    };

    const manager = chaosManager ?? null;
    if (manager) {
      manager.startTransaction(selector, 'STRESS_CLICK', metadata);
    } else {
      console.log(
        '[StressScenario:ButtonSpammer] No ChaosTransactionManager provided - running without transaction tracking',
      );
    }

    const recorder = new StressClickMetadataRecorder(metadata);

    try {
      // Fire CLICK_COUNT concurrent clicks at the single target (zero-wait).
      const result = await executeConcurrentBurst(
        page,
        Array.from({ length: CLICK_COUNT }, () => selector),
      );
      recorder.record(result);

      // Record the burst as a SINGLE reproduction step so the 20-slot playbook
      // buffer is not flooded with redundant rapid-click entries.
      ActionRecorder.recordStep({
        actionType: 'CLICK',
        humanIdentifier: target?.innerText?.trim() || selector,
        value: `Concurrent zero-wait burst ×${CLICK_COUNT}`,
        selector,
        url: page.url(),
      });
      const label = target ? resolveElementLabel(target) : 'button';
      const kind = genericElementLabel(target?.tagName, target?.type);
      ActiveScenarioTracker.record(describeBurst(result, label, kind));

      console.log(
        `[StressScenario:ButtonSpammer] Burst completed ${result.completed}/${result.attempted} in ${result.durationMs}ms`,
      );
    } finally {
      manager?.endTransaction();
    }
  },
};

export type ButtonSpammer = typeof buttonSpammer;

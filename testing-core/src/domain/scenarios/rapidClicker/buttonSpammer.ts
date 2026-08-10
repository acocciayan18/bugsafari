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
import type { ChaosTransactionManager, StressClickMetadata } from '../../chaos/index.js';
import { CLICK_COUNT } from './utils.js';
import { executeConcurrentBurst } from './concurrentBurst.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { nextBurstId } from '../../../infrastructure/monitoring/burstCorrelation.js';
import {
  resolveElementLabel,
  elementNoun,
  describeConcurrentBurstIntent,
  describeBurstOutcome,
  describeInertBurst,
} from '../../services/forensics/narration.js';
import { StressClickMetadataRecorder } from '../../services/forensics/metadataRecorder.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StressScenario:ButtonSpammer]');

export const buttonSpammer = {
  name: 'ButtonSpammer',

  async execute(
    page: Page,
    target?: InteractiveElement,
    chaosManager?: ChaosTransactionManager<StressClickMetadata> | null,
  ): Promise<void> {
    const selector = target?.selector ?? 'button, [role="button"], a';

    obsLog.info(
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
      obsLog.info(
        '[StressScenario:ButtonSpammer] No ChaosTransactionManager provided - running without transaction tracking',
      );
    }

    const recorder = new StressClickMetadataRecorder(metadata);

    // Record the burst as a SINGLE reproduction step BEFORE firing it, so a crash on
    // the very first click still leaves developers the controls + action that caused it
    // (the burst used to be recorded only after it settled — an immediate crash then
    // produced "No reproduction steps were recorded for this fault").
    const label = target ? resolveElementLabel(target) : '';
    const kind = elementNoun(target?.tagName, target?.type);
    ActionRecorder.recordStep({
      actionType: 'CLICK',
      humanIdentifier: label,
      elementKind: kind,
      selector,
      url: page.url(),
      repeatCount: CLICK_COUNT,
      burstId: nextBurstId(),
    });
    ActiveScenarioTracker.record(describeConcurrentBurstIntent(label, kind, CLICK_COUNT));

    try {
      // Fire CLICK_COUNT concurrent clicks at the single target (zero-wait).
      const result = await executeConcurrentBurst(
        page,
        Array.from({ length: CLICK_COUNT }, () => selector),
      );
      recorder.record(result);
      // The intent step is already in the window; append the measured outcome. When ZERO
      // clicks registered the burst never touched the app, so flag the reproduction invalid
      // instead of implying the clicks landed (an unrelated fault must not inherit a
      // misleading "clicked N times" playbook).
      ActiveScenarioTracker.observe(
        result.completed === 0 ? describeInertBurst(result.attempted) : describeBurstOutcome(result),
      );

      obsLog.info(
        `[StressScenario:ButtonSpammer] Burst completed ${result.completed}/${result.attempted} in ${result.durationMs}ms`,
      );
    } finally {
      manager?.endTransaction();
    }
  },
};

export type ButtonSpammer = typeof buttonSpammer;

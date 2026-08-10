/**
 * Interaction Simulator
 *
 * - concurrentClicker: true zero-wait concurrent clicking across sibling elements
 *
 * The former `buttonSpammer` method (a 300 ms loop of in-page `node.click()`)
 * was the exploratory BASELINE interaction, so every traversal click was an
 * untrusted ~30x burst (audit P3-01). Traversal now uses the trusted single
 * click in `exploration/trustedClick.ts`; click-flooding is once again reachable
 * only through the operator-gated ButtonSpammer scenario.
 */

import type { Page } from 'playwright';
import type { StepTarget } from '../../../../../shared/types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, StressClickMetadata } from '../../chaos/index.js';
import { executeConcurrentBurst } from './concurrentBurst.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { nextBurstId } from '../../../infrastructure/monitoring/burstCorrelation.js';
import {
  describeConcurrentBurstSiblingsIntent,
  describeBurstOutcome,
  describeInertBurst,
  elementNoun,
  resolveElementLabel,
} from '../../services/forensics/narration.js';
import { StressClickMetadataRecorder } from '../../services/forensics/metadataRecorder.js';

/**
 * Interaction Simulator for executing rapid click operations.
 */
export class InteractionSimulator {
  /**
   * Fires a true zero-wait concurrent burst across up to 5 sibling selectors to
   * expose overlapping-update race conditions. When a ChaosTransactionManager is
   * injected, it opens a STRESS_CLICK transaction and records deterministic
   * execution metadata so any fault during the burst is attributed and
   * reproducible. The caller owns the ActiveScenarioTracker window.
   *
   * Takes the scanned elements (not bare selectors) so the recorded step can name
   * the controls a developer sees — "the "Save" button, the "Cancel" button" —
   * instead of dumping CSS selectors into the reproduction playbook.
   *
   * @param page Playwright Page object
   * @param elements Sibling elements to click concurrently
   * @param chaosManager Optional shared transaction manager for live tracking
   */
  public async concurrentClicker(
    page: Page,
    elements: InteractiveElement[],
    chaosManager?: ChaosTransactionManager<StressClickMetadata> | null,
  ): Promise<void> {
    const targets = elements.slice(0, 5).filter((element) => Boolean(element?.selector));
    const targetSelectors = targets.map((element) => element.selector);
    if (targetSelectors.length === 0) {
      return;
    }
    const named: StepTarget[] = targets.map((element) => ({
      label: resolveElementLabel(element),
      kind: elementNoun(element.tagName, element.type),
    }));

    const manager = chaosManager ?? null;
    const metadata: StressClickMetadata = {
      velocity: 0,
      elementChain: [...targetSelectors],
      targetSelector: targetSelectors[0],
      clickCount: targetSelectors.length,
    };
    if (manager) {
      manager.startTransaction(targetSelectors[0], 'STRESS_CLICK', metadata);
    }

    const recorder = new StressClickMetadataRecorder(metadata);

    // Record the burst BEFORE firing it so an immediate crash still names the controls
    // involved (the step used to be recorded only after the burst settled — a mid-burst
    // crash then left the finding with no reproduction steps). The re-expandable MACRO
    // carries the resolved sibling selectors so regression replay re-fires the exact
    // concurrent burst; `targets` rides alongside so the playbook names the controls.
    const intent = describeConcurrentBurstSiblingsIntent(named, targetSelectors.length);
    ActionRecorder.recordStep({
      actionType: 'MACRO',
      humanIdentifier: named[0].label,
      elementKind: named[0].kind,
      selector: targetSelectors[0],
      url: page.url(),
      burstId: nextBurstId(),
      macro: {
        scenario: 'ConcurrentSiblingBurst',
        params: { selectors: targetSelectors, targets: named },
        summary: intent,
      },
    });
    ActiveScenarioTracker.record(intent);

    try {
      const result = await executeConcurrentBurst(page, targetSelectors);
      recorder.record(result);
      // Intent step already recorded; append the measured outcome. Zero registered clicks
      // means no control was actuable — flag the reproduction invalid rather than implying
      // a burst that never landed.
      ActiveScenarioTracker.observe(
        result.completed === 0 ? describeInertBurst(result.attempted) : describeBurstOutcome(result),
      );
    } finally {
      manager?.endTransaction();
    }
  }
}

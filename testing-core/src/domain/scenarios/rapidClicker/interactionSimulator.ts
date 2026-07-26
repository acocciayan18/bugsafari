/**
 * Interaction Simulator
 *
 * Provides methods for simulating rapid click operations:
 * - buttonSpammer: baseline rapid single-element clicking (exploratory baseline)
 * - concurrentClicker: true zero-wait concurrent clicking across sibling elements
 */

import type { Page } from 'playwright';
import type { StepTarget } from '../../../../../shared/types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ChaosTransactionManager, StressClickMetadata } from '../../chaos/index.js';
import { wait } from './utils.js';
import { executeConcurrentBurst } from './concurrentBurst.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import {
  describeConcurrentBurstSiblings,
  elementNoun,
  resolveElementLabel,
} from '../../services/forensics/narration.js';
import { StressClickMetadataRecorder } from '../../services/forensics/metadataRecorder.js';

/**
 * Interaction Simulator for executing rapid click operations.
 */
export class InteractionSimulator {
  /**
   * Performs rapid baseline button clicking on a single selector via in-page
   * dispatch. This is the exploratory-baseline interaction, not the concurrent
   * stress path (see {@link concurrentClicker}).
   *
   * @param page Playwright Page object
   * @param selector CSS selector to spam clicks on
   */
  public async buttonSpammer(page: Page, selector: string): Promise<void> {
    const durationMs = 300;
    const start = Date.now();

    while (Date.now() - start < durationMs) {
      await page
        .evaluate((sel) => {
          const node = document.querySelector(sel) as HTMLElement | null;
          if (node) {
            node.click();
          }
        }, selector)
        .catch(() => undefined);
      await wait(10);
    }
  }

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

    try {
      const result = await executeConcurrentBurst(page, targetSelectors);
      recorder.record(result);
      const burstSummary = describeConcurrentBurstSiblings(result, named);
      // Re-expandable MACRO carrying the resolved sibling selectors so regression
      // replay re-fires the exact concurrent burst (not param-derivable, unlike the
      // coordinate/route macros — the selectors must travel with the finding).
      // `targets` rides alongside so the playbook names the controls, not selectors.
      ActionRecorder.recordStep({
        actionType: 'MACRO',
        humanIdentifier: named[0].label,
        elementKind: named[0].kind,
        selector: targetSelectors[0],
        url: page.url(),
        macro: {
          scenario: 'ConcurrentSiblingBurst',
          params: { selectors: targetSelectors, targets: named },
          summary: burstSummary,
        },
      });
      ActiveScenarioTracker.record(burstSummary);
    } finally {
      manager?.endTransaction();
    }
  }
}

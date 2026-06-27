/**
 * Button Spammer Stress Scenario
 *
 * Clicks the target element 15 times rapidly with 50ms delays between each click.
 * Does not await individual clicks to flood the browser event queue.
 *
 * This stress test is designed to:
 * - Overwhelm SPA state management
 * - Trigger race conditions in event handlers
 * - Test for memory leaks in click handlers
 */

import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { StressScenario } from '../types.js';
import {
  CLICK_COUNT,
  CLICK_DELAY_MS,
  getChaosTransactionManager,
  isNonFatalNavigationError,
  wait,
} from './utils.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel, genericElementLabel } from '../../../infrastructure/monitoring/playbookNarrator.js';

/**
 * Button Spammer stress scenario.
 *
 * Clicks the target element 15 times rapidly with 50ms delays between each click.
 * Does not await individual clicks to flood the browser event queue.
 *
 * This stress test is designed to:
 * - Overwhelm SPA state management
 * - Trigger race conditions in event handlers
 * - Test for memory leaks in click handlers
 */
export const buttonSpammer: StressScenario = {
  name: 'ButtonSpammer',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    const selector = target?.selector ?? 'button, [role="button"], a';

    console.log(
      `[StressScenario:ButtonSpammer] Starting spam with ${CLICK_COUNT} clicks on '${selector}'`
    );

    // Build the element chain from target selector
    const elementChain: string[] = [selector];

    // Create metadata for the chaos transaction
    const metadata = {
      velocity: CLICK_DELAY_MS,
      elementChain: elementChain,
    };

    // Start the chaos transaction with STRESS_CLICK type
    // Use global singleton pattern for the transaction manager
    const chaosManager = getChaosTransactionManager();
    if (chaosManager) {
      chaosManager.startTransaction(selector, 'STRESS_CLICK', metadata);
    }

    const clickPromises: Promise<void>[] = [];

    // Record the burst as a SINGLE reproduction step (not one per click) so the
    // 20-slot playbook buffer is not flooded with redundant rapid-click entries.
    ActionRecorder.recordStep({
      actionType: 'CLICK',
      humanIdentifier: target?.innerText?.trim() || selector,
      value: `Rapidly clicked ${CLICK_COUNT} times`,
      selector: selector,
      url: page.url(),
    });
    const clickLabel = target ? resolveElementLabel(target) : 'button';
    const clickKind = genericElementLabel(target?.tagName, target?.type);
    ActiveScenarioTracker.record(`Click interaction triggered on element ${clickKind}: "${clickLabel}" (concurrent ${CLICK_COUNT}× burst)`);

    // Execute clicks rapidly without awaiting individual clicks
    // This floods the browser event queue
    for (let i = 0; i < CLICK_COUNT; i++) {
        const clickPromise = page
        .click(selector, { force: true })
        .then(() => {
          console.log(`[StressScenario:ButtonSpammer] Click ${i + 1}/${CLICK_COUNT} completed`);
        })
        .catch((error: Error) => {
          // Handle errors gracefully - don't let one failed click stop the scenario
          if (isNonFatalNavigationError(error)) {
            console.log(
              `[StressScenario:ButtonSpammer] Ignored navigation error on click ${i + 1}: ${error.message}`
            );
          } else {
            console.error(
              `[StressScenario:ButtonSpammer] Non-fatal error on click ${i + 1}: ${error.message}`
            );
          }
        });

      clickPromises.push(clickPromise);

      // Small delay between clicks (but we don't await the click itself)
      await wait(CLICK_DELAY_MS);
    }

    // Wait for all click promises to settle (or fail)
    await Promise.allSettled(clickPromises);

    // Close the chaos transaction
    if (chaosManager) {
      chaosManager.closeTransaction();
    }

    console.log(`[StressScenario:ButtonSpammer] Spam completed with ${CLICK_COUNT} clicks`);
  },
};

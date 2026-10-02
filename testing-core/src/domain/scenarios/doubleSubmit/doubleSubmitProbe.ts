import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import { nextBurstId } from '../../../infrastructure/monitoring/burstCorrelation.js';
import { resolveElementLabel, elementNoun } from '../../services/forensics/narration.js';
import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StressScenario:DoubleSubmitProbe]');

// Trusted-only click budget. No force / dispatch fallback on purpose: a control a
// guard disables on submit rightly fails the second click, so a guarded button
// yields no duplicate pair and no finding. Short so a guarded control costs little.
const CLICK_TIMEOUT_MS = 1200;

// Reproducible double-submit probe. Unlike ButtonSpammer (zero-wait force flood that
// the live DuplicateActionFinder vetoes as an engine artifact), this fires exactly
// two GENUINE trusted clicks on the SAME control. The first click's request is in
// flight when the second fires, so the finder pairs the identical state-changing
// requests. A debounce / disable-on-submit guard blocks the second click, so a
// finding appears only when the control is actually unguarded, and the pair is
// something a real user can reproduce. Not in the race-veto list, so observeRequest
// stays live for this scenario's traffic.
export const doubleSubmitProbe = {
  name: 'DoubleSubmitProbe',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    const selector = target?.selector;
    if (!selector || page.isClosed()) return;

    const label = target ? resolveElementLabel(target) : '';
    // One reproduction step (repeatCount 2) recorded before firing, so a crash mid-probe
    // still leaves the causing control + action; the finding itself prefers the finder's
    // own two-request replay.
    ActionRecorder.recordStep({
      actionType: 'CLICK',
      humanIdentifier: label,
      elementKind: elementNoun(target?.tagName, target?.type),
      selector,
      url: page.url(),
      repeatCount: 2,
      burstId: nextBurstId(),
    });

    const locator = page.locator(selector).first();

    // First real click — nothing to probe if the control cannot be actuated at all.
    try {
      await locator.click({ timeout: CLICK_TIMEOUT_MS });
    } catch {
      obsLog.info(`[StressScenario:DoubleSubmitProbe] First click did not actuate '${selector}' — skipping probe.`);
      return;
    }

    // Second real click, no force: lands only while the control is still enabled and
    // hit-testable. A guard that disables on submit makes this fail (correctly no
    // duplicate); when it lands, the two identical requests overlap for the finder.
    try {
      await locator.click({ timeout: CLICK_TIMEOUT_MS });
    } catch {
      obsLog.info(`[StressScenario:DoubleSubmitProbe] Second click blocked on '${selector}' — control appears guarded.`);
    }
  },
};

export type DoubleSubmitProbe = typeof doubleSubmitProbe;

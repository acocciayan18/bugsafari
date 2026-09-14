// metamorphic/roundTripOracle.ts — reversibility oracle.
// Opening then closing a transient layer must restore the page. A leftover backdrop,
// orphaned portal, or un-reverted control is a METAMORPHIC_STATE_LEAK. No app knowledge
// and no correct-answer needed: the start state IS the expected end state.

import type { BugFinder, BugContext, BugFinding } from '../../types.js';
import { captureCompound, equivalent, detectModalOpeners, type CompoundCapture } from './relations.js';
import { resolveElementLabel } from '../../../domain/services/forensics/narration.js';
import { safeRoutePath } from '../../../domain/services/exploration/bugIdentity.js';

// Scoped dismiss affordances tried before falling back to Escape. Bounded to close
// controls (inside a dialog, or an explicit close/dismiss label) so we never actuate an
// arbitrary control to "close".
const CLOSE_SELECTOR =
  '[role=dialog] [aria-label*="close" i], [role=dialog] [data-dismiss], [data-dismiss], ' +
  'button[aria-label*="close" i], .modal .close, [class*="close" i][role=button]';

// Core is capture-injectable so it is unit-testable without a real browser.
export async function evaluateRoundTrip(
  ctx: BugContext,
  capture: CompoundCapture = captureCompound,
): Promise<BugFinding[]> {
  const opener = detectModalOpeners(ctx.rankedTargets ?? [])[0];
  if (!opener) return [];

  const page = ctx.page;
  const urlBefore = page.url();
  try {
    const baseline = await capture(page);
    await page.locator(opener.selector).first().click({ timeout: 1000 }).catch(() => undefined);

    // A navigation means this was a link, not a layer toggle — not our case.
    if (page.url() !== urlBefore) return [];

    const opened = await capture(page);
    // The click was a no-op (nothing rendered) — nothing to round-trip, no finding.
    if (equivalent(baseline, opened)) return [];

    // Close: prefer a scoped dismiss affordance, else Escape.
    const closeBtn = page.locator(CLOSE_SELECTOR).first();
    const hasClose = (await closeBtn.count().catch(() => 0)) > 0;
    if (hasClose) await closeBtn.click({ timeout: 1000 }).catch(() => undefined);
    else await page.keyboard.press('Escape').catch(() => undefined);

    const closed = await capture(page);
    // Restored cleanly — healthy round-trip.
    if (equivalent(baseline, closed)) return [];

    const label = resolveElementLabel(opener);
    const route = safeRoutePath(page) || urlBefore;
    return [
      {
        bugClass: 'METAMORPHIC_STATE_LEAK',
        title: 'Closing a dialog left the page changed',
        severity: 'MEDIUM',
        evidence: {
          message: `Opening then closing "${label}" did not restore the page — leftover DOM/state remained after it was dismissed.`,
          actionExecuted: 'metamorphic-round-trip',
          selector: opener.selector,
          stateHash: ctx.stateHash,
          reproductionPlaybook: [
            `Step 1. On ${route}, open "${label}".`,
            `Step 2. Close it using its close control or the Escape key.`,
            `Step 3. Observe the page did not return to its original state (leftover overlay/elements).`,
          ],
        },
      },
    ];
  } finally {
    // Never leave the loop on a different URL than it handed us.
    if (page.url() !== urlBefore) {
      await page.goto(urlBefore, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => undefined);
    }
  }
}

export const roundTripOracle: BugFinder = {
  bugClass: 'METAMORPHIC_STATE_LEAK',

  isApplicable(ctx: Omit<BugContext, 'crashHalted'>): boolean {
    return detectModalOpeners(ctx.rankedTargets ?? []).length > 0;
  },

  run(ctx: BugContext): Promise<BugFinding[]> {
    return evaluateRoundTrip(ctx);
  },
};

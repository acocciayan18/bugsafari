// metamorphic/roundTripOracle.ts — reversibility oracle.
// Opening then closing a transient layer must restore the page. A leftover backdrop,
// orphaned portal, or un-reverted control is a METAMORPHIC_STATE_LEAK. No app knowledge
// and no correct-answer needed: the start state IS the expected end state.

import type { BugFinder, BugContext, BugFinding } from '../../types.js';
import { captureCompound, equivalent, volatileOnly, detectModalOpeners, type CompoundCapture } from './relations.js';
import { resolveElementLabel } from '../../../domain/services/forensics/narration.js';
import { safeRoutePath } from '../../../domain/services/exploration/bugIdentity.js';
import { routeKey } from '../../../ml/domHasher.js';
import { VolatilityModel } from '../../../domain/services/baseline/volatilityModel.js';

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
  const key = routeKey(urlBefore);
  try {
    const baseline = await capture(page);
    // A second action-free read learns which fields churn on their own (clocks, tokens),
    // independent of the open/close diff under test.
    const baseline2 = await capture(page);
    VolatilityModel.record(key, baseline.paths, baseline2.paths);

    await page.locator(opener.selector).first().click({ timeout: 1000 }).catch(() => undefined);

    // A navigation means this was a link, not a layer toggle — not our case.
    if (page.url() !== urlBefore) return [];

    const opened = await capture(page);
    // The click was a no-op (nothing rendered) — nothing to round-trip, no finding.
    if (equivalent(baseline.hash, opened.hash)) return [];

    // Close: prefer a scoped dismiss affordance, else Escape.
    const closeBtn = page.locator(CLOSE_SELECTOR).first();
    const hasClose = (await closeBtn.count().catch(() => 0)) > 0;
    if (hasClose) await closeBtn.click({ timeout: 1000 }).catch(() => undefined);
    else await page.keyboard.press('Escape').catch(() => undefined);

    const closed = await capture(page);
    // Restored cleanly — healthy round-trip.
    if (equivalent(baseline.hash, closed.hash)) return [];
    // Differs only by dynamic content the app churns on its own — not a leak.
    if (volatileOnly(key, baseline, closed)) return [];
    // Cycle 1 shows a non-volatile leak. One cycle alone is weak evidence: a framework portal
    // container or a one-shot focus marker can leave a residue the next interaction reconciles.
    // Require the leak to CORROBORATE across a second open/close cycle (fb-test.txt #4 was a
    // single-cycle 75% finding). The stable field-level residual, when a path map is available.
    const residual1 = VolatilityModel.stableDiff(key, baseline.paths, closed.paths);

    // Second cycle: open and close again from the current state.
    await page.locator(opener.selector).first().click({ timeout: 1000 }).catch(() => undefined);
    if (page.url() !== urlBefore) return [];
    const opened2 = await capture(page);
    // The layer did not re-open (opener now inert) — cannot corroborate, so do not report.
    if (equivalent(baseline.hash, opened2.hash)) return [];
    const closeBtn2 = page.locator(CLOSE_SELECTOR).first();
    const hasClose2 = (await closeBtn2.count().catch(() => 0)) > 0;
    if (hasClose2) await closeBtn2.click({ timeout: 1000 }).catch(() => undefined);
    else await page.keyboard.press('Escape').catch(() => undefined);

    const closed2 = await capture(page);
    // Self-healed on the second cycle — not a persistent leak.
    if (equivalent(baseline.hash, closed2.hash)) return [];
    if (volatileOnly(key, baseline, closed2)) return [];
    // When a field-level map is available, the leak must PERSIST or GROW: every stable leftover
    // path from cycle 1 is still leaked after cycle 2 (residual2 ⊇ residual1). A residue that
    // shifts or shrinks away is not reported. With no path map it is a structural hash leak, and
    // the two cycles' equivalent/volatileOnly guards above already proved it persists.
    const residual2 = VolatilityModel.stableDiff(key, baseline.paths, closed2.paths);
    if (residual1.size > 0 && !(residual2.size > 0 && [...residual1].every((p) => residual2.has(p)))) {
      return [];
    }

    const label = resolveElementLabel(opener);
    const route = safeRoutePath(page) || urlBefore;
    return [
      {
        bugClass: 'METAMORPHIC_STATE_LEAK',
        title: 'Closing a dialog left the page changed',
        severity: 'MEDIUM',
        evidence: {
          message: `Opening then closing "${label}" did not restore the page — the same leftover DOM/state remained after two open/close cycles (${residual2.size} stable field(s) not reverted).`,
          actionExecuted: 'metamorphic-round-trip',
          selector: opener.selector,
          stateHash: ctx.stateHash,
          reproductionPlaybook: [
            `Step 1. On ${route}, open "${label}".`,
            `Step 2. Close it using its close control or the Escape key.`,
            `Step 3. Repeat the open/close once more.`,
            `Step 4. Observe the page did not return to its original state (the same leftover overlay/elements persist across both cycles).`,
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

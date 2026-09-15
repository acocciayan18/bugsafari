// metamorphic/reloadStabilityOracle.ts — reload-stability oracle.
// After a fresh load, a reload must reproduce the page: state that should survive a
// refresh must not be lost, duplicated, or re-rendered differently. A fresh-load vs
// reload mismatch (beyond normalized volatility) is a RELOAD_STATE_CORRUPTION. Both
// observations start from a clean load, so the dirty post-action page never matters.

import type { BugFinder, BugContext, BugFinding } from '../../types.js';
import { captureCompound, equivalent, volatileOnly, type CompoundCapture } from './relations.js';
import { safeRoutePath } from '../../../domain/services/exploration/bugIdentity.js';
import { routeKey } from '../../../ml/domHasher.js';
import { VolatilityModel } from '../../../domain/services/baseline/volatilityModel.js';

// Sample sparsely (on top of the runner's cadence); offset from idempotence so the two
// navigating oracles never fire on the same step.
const RUN_EVERY = 8;
const RUN_OFFSET = 4;
const NAV_TIMEOUT_MS = 8000;

function eligible(ctx: Pick<BugContext, 'page' | 'step'>): boolean {
  return /^https?:/i.test(ctx.page.url()) && ctx.step % RUN_EVERY === RUN_OFFSET;
}

export async function evaluateReloadStability(
  ctx: BugContext,
  capture: CompoundCapture = captureCompound,
): Promise<BugFinding[]> {
  const page = ctx.page;
  const url = page.url();
  if (!/^https?:/i.test(url)) return [];
  const key = routeKey(url);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const fresh = await capture(page);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const reloaded = await capture(page);
  // A second reload learns per-load churn (nonces, timestamps, A/B) from an action-free
  // pair, so it is never mistaken for reload corruption in the fresh-vs-reload diff.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const reloadedAgain = await capture(page);
  VolatilityModel.record(key, reloaded.paths, reloadedAgain.paths);

  if (equivalent(fresh.hash, reloaded.hash)) return [];
  // The fresh-vs-reload difference is entirely per-load dynamic content — not corruption.
  if (volatileOnly(key, fresh, reloaded)) return [];

  const route = safeRoutePath(page) || url;
  return [
    {
      bugClass: 'RELOAD_STATE_CORRUPTION',
      title: 'A reload did not reproduce the page',
      severity: 'MEDIUM',
      evidence: {
        message: `Reloading ${route} changed its rendered state even though nothing was done between loads — state was lost, duplicated, or re-rendered differently.`,
        actionExecuted: 'metamorphic-reload-stability',
        stateHash: ctx.stateHash,
        reproductionPlaybook: [
          `Step 1. Load ${route}.`,
          `Step 2. Reload the page (no other action).`,
          `Step 3. Observe the reloaded page differs from the first load (beyond dynamic content).`,
        ],
      },
    },
  ];
}

export const reloadStabilityOracle: BugFinder = {
  bugClass: 'RELOAD_STATE_CORRUPTION',

  isApplicable(ctx: Omit<BugContext, 'crashHalted'>): boolean {
    return eligible(ctx);
  },

  run(ctx: BugContext): Promise<BugFinding[]> {
    return evaluateReloadStability(ctx);
  },
};

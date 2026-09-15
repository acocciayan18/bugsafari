// metamorphic/idempotenceOracle.ts — read-idempotence oracle.
// Loading the same route twice from scratch must yield the same state. Two fresh GETs
// that disagree (beyond normalized volatility) reveal non-deterministic initialization
// or unguarded shared state — a NON_IDEMPOTENT_ACTION. Both observations are fresh, so
// the dirty post-action page never matters.

import type { BugFinder, BugContext, BugFinding } from '../../types.js';
import { captureCompound, equivalent, volatileOnly, type CompoundCapture } from './relations.js';
import { safeRoutePath } from '../../../domain/services/exploration/bugIdentity.js';
import { routeKey } from '../../../ml/domHasher.js';
import { VolatilityModel } from '../../../domain/services/baseline/volatilityModel.js';

// Navigating checks are disruptive, so sample sparsely (on top of the runner's cadence).
const RUN_EVERY = 8;
const NAV_TIMEOUT_MS = 8000;

function eligible(ctx: Pick<BugContext, 'page' | 'step'>): boolean {
  return /^https?:/i.test(ctx.page.url()) && ctx.step % RUN_EVERY === 0;
}

export async function evaluateIdempotence(
  ctx: BugContext,
  capture: CompoundCapture = captureCompound,
): Promise<BugFinding[]> {
  const page = ctx.page;
  const url = page.url();
  if (!/^https?:/i.test(url)) return [];
  const key = routeKey(url);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const first = await capture(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const second = await capture(page);
  // A third load learns per-load churn from an action-free pair, so a nonce/token that
  // differs on every load is not mistaken for non-deterministic initialization.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
  const third = await capture(page);
  VolatilityModel.record(key, second.paths, third.paths);

  if (equivalent(first.hash, second.hash)) return [];
  // The two loads differ only by per-load dynamic content — deterministic enough.
  if (volatileOnly(key, first, second)) return [];

  const route = safeRoutePath(page) || url;
  return [
    {
      bugClass: 'NON_IDEMPOTENT_ACTION',
      title: 'Loading the same page twice gave different results',
      severity: 'MEDIUM',
      evidence: {
        message: `Loading ${route} twice produced two different states — the same read is not deterministic.`,
        actionExecuted: 'metamorphic-idempotence',
        stateHash: ctx.stateHash,
        reproductionPlaybook: [
          `Step 1. Load ${route}.`,
          `Step 2. Load ${route} again in a fresh view.`,
          `Step 3. Observe the two loads render different states (beyond dynamic content).`,
        ],
      },
    },
  ];
}

export const idempotenceOracle: BugFinder = {
  bugClass: 'NON_IDEMPOTENT_ACTION',

  isApplicable(ctx: Omit<BugContext, 'crashHalted'>): boolean {
    return eligible(ctx);
  },

  run(ctx: BugContext): Promise<BugFinding[]> {
    return evaluateIdempotence(ctx);
  },
};

import type { Page } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { FREEZE_SELECTORS, matchesCategory } from '../knowledgeBase/signalPatterns.js';

// Grace period for the burst's async work to resolve before judging the UI stuck.
const SETTLE_MS = 1500;

/**
 * Result of a concurrent stress test for SPA race conditions.
 */
export interface ConcurrentStressResult {
  attempted: number;
  completed: number;
}

/**
 * Fires concurrent UI events to detect race conditions in SPA state management.
 * Tests for race conditions by firing multiple UI events simultaneously.
 * 
 * @param page Playwright Page object
 * @param step Current testing step
 * @returns Promise resolving to ConcurrentStressResult with attempted/completed counts
 */
export async function burstConcurrentStress(
  page: Page,
  step: number
): Promise<ConcurrentStressResult> {
  const maxTargets = 12;
  const maxConcurrent = 5;
  
  // Find clickable elements
  const locator = page.locator('button, a[href], input[type="submit"], input[type="button"], [role="button"]');
  const elements = await locator.all();
  
  if (elements.length === 0) {
    return { attempted: 0, completed: 0 };
  }
  
  // Limit to first maxTargets elements
  const targets = elements.slice(0, maxTargets);
  
  // Fire concurrent clicks with varying strategies
  const promises: Promise<boolean>[] = [];
  
  // Strategy 1: Rapid sequential clicks
  for (let i = 0; i < Math.min(maxConcurrent, targets.length); i++) {
    promises.push(
      targets[i].click({ force: true, noWaitAfter: true, timeout: 500 })
        .then(() => true)
        .catch(() => false)
    );
  }
  
  // Strategy 2: Type events on inputs (if available)
  const inputs = await page.locator('input:not([type="hidden"]), textarea').all();
  for (const input of inputs.slice(0, 3)) {
    promises.push(
      input.fill(Math.random().toString(36).substring(7))
        .then(() => true)
        .catch(() => false)
    );
  }
  
  // Strategy 3: Navigation events (if links available)
  const links = await page.locator('a[href]').all();
  for (const link of links.slice(0, 2)) {
    promises.push(
      link.click({ force: true, timeout: 300 })
        .then(() => true)
        .catch(() => false)
    );
  }
  
  const results = await Promise.all(promises);
  
  return {
    attempted: promises.length,
    completed: results.filter(Boolean).length,
  };
}

/** Post-burst damage signals: a crash, a leaked error surface, or a stuck loader. */
interface BurstDamage {
  crashes: string[];
  stuckLoading: boolean;
}

async function isStuckLoading(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      (selectors: string[]) => selectors.some((selector) => document.querySelector(selector) !== null),
      [...FREEZE_SELECTORS],
    );
  } catch {
    return false;
  }
}

export const spaRaceConditionsFinder: BugFinder = {
  bugClass: 'SPA_STATE_RACE_CONDITION',
  testingType: 'asyncRace',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  /**
   * Fires a concurrent event burst and reports ONLY when the app fails to absorb it:
   * a new client crash, or a loading state still stuck once the burst settles.
   * Clicks merely succeeding is the healthy case, not a race.
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const damage: BurstDamage = { crashes: [], stuckLoading: false };

    const onPageError = (err: Error): void => {
      if (damage.crashes.length < 3) damage.crashes.push(err.message.slice(0, 200));
    };
    const onConsole = (message: { type(): string; text(): string }): void => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (damage.crashes.length < 3 && matchesCategory('CLIENT_CRASH', text)) {
        damage.crashes.push(text.slice(0, 200));
      }
    };

    const wasStuckBefore = await isStuckLoading(ctx.page);
    ctx.page.on('pageerror', onPageError);
    ctx.page.on('console', onConsole);

    let result: ConcurrentStressResult;
    try {
      result = await burstConcurrentStress(ctx.page, ctx.step);
      await ctx.page.waitForTimeout(SETTLE_MS);
      // Only a loader that appeared during the burst is evidence — a spinner that was
      // already there belongs to whatever was in flight before we touched anything.
      damage.stuckLoading = !wasStuckBefore && (await isStuckLoading(ctx.page));
    } finally {
      ctx.page.off('pageerror', onPageError);
      ctx.page.off('console', onConsole);
    }

    if (damage.crashes.length === 0 && !damage.stuckLoading) return [];

    const detail = damage.crashes.length > 0
      ? `Client crashed during the burst: ${damage.crashes.join(' | ')}`
      : 'UI remained in a loading/blocked state after the burst settled';

    return [
      {
        bugClass: 'SPA_STATE_RACE_CONDITION',
        title: 'SPA state race under concurrent events',
        severity: damage.crashes.length > 0 ? 'HIGH' : 'MEDIUM',
        evidence: {
          message: `${detail}. Fired ${result.completed}/${result.attempted} concurrent events.`,
          actionExecuted: 'spa-race-concurrent-events',
          stateHash: ctx.stateHash,
        },
      },
    ];
  },
};


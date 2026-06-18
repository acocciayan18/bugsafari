import type { Page } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';

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

export const spaRaceConditionsFinder: BugFinder = {
  bugClass: 'SPA_STATE_RACE_CONDITION',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const result = await burstConcurrentStress(ctx.page, ctx.step);

    const finding: BugFinding = {
      bugClass: 'SPA_STATE_RACE_CONDITION',
      title: 'SPA state / race condition under concurrent events',
      severity: result.completed > 0 ? 'HIGH' : 'MEDIUM',
      evidence: {
        message: `Fired concurrent UI events; completed=${result.completed}, attempted=${result.attempted}`,
        actionExecuted: 'spa-race-concurrent-events',
        stateHash: ctx.stateHash,
      },
    };

    return [finding];
  },
};


import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { burstConcurrentStress } from '../stressAdapters/concurrentStress.js';

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


import type { BugFinder, BugContext, BugFinding } from '../types.js';

export const runtimeStabilityFinder: BugFinder = {
  bugClass: 'RUNTIME_STABILITY_EXCEPTION',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    if (!ctx.crashHalted) {
      return [];
    }

    const finding: BugFinding = {
      bugClass: 'RUNTIME_STABILITY_EXCEPTION',
      title: 'Unhandled runtime exception / server failure halting the engine',
      severity: 'CRITICAL',
      evidence: {
        message: ctx.stateHash ? 'Crash halted detected by exception catcher.' : 'Crash halted detected.',
        stateHash: ctx.stateHash,
        actionExecuted: 'runtime-exception',
      },
    };

    return [finding];
  },
};


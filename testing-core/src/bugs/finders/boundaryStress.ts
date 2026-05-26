import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { boundaryOverloadProbe } from '../stressAdapters/boundaryOverload.js';

export const boundaryStressFinder: BugFinder = {
  bugClass: 'BOUNDARY_STRESS_FAILURE',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const result = await boundaryOverloadProbe(ctx.page, ctx.step);

    const finding: BugFinding = {
      bugClass: 'BOUNDARY_STRESS_FAILURE',
      title: 'Boundary / stress failure (string overload / event-loop starvation proxy)',
      severity: result.unresponsive ? 'CRITICAL' : 'HIGH',
      evidence: {
        message: `Boundary probe: unresponsive=${result.unresponsive}; durationMs=${result.durationMs}; attempted=${result.attempted}`,
        actionExecuted: 'boundary-stress-probe',
        stateHash: ctx.stateHash,
      },
    };

    return [finding];
  },
};


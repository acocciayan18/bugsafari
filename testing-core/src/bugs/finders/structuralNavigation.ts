import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { probeStructuralNavigation } from '../stressAdapters/index.js';

export const structuralNavigationFinder: BugFinder = {
  bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const result = await probeStructuralNavigation(ctx.page, ctx.step);

    const finding: BugFinding = {
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      title: 'Structural navigation logic bug (loops / dead-ends / hidden crashes)',
      severity: result.detected ? 'HIGH' : 'MEDIUM',
      evidence: {
        message: `Structural probe: detected=${result.detected}; details=${result.details}`,
        actionExecuted: 'structural-navigation-probe',
        stateHash: ctx.stateHash,
      },
    };

    return [finding];
  },
};

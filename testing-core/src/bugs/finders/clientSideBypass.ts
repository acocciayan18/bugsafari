import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { ensureConstraintsStripped, fuzzTextWithAttackSurface } from '../scenarioAdapters.js';

export const clientSideConstraintBypassFinder: BugFinder = {
  bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',

  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;
    return el.isDisabled || ['INPUT', 'LOGIN'].includes(el.semanticRole);
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    if (!ctx.element) return [];

    await ensureConstraintsStripped(ctx.page, ctx.element.selector);

    const payload = await fuzzTextWithAttackSurface(ctx.page, ctx.element, ctx.step, {
      profile: 'xss_sql_unicode',
    });

    return [
      {
        bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
        title: 'Client-side constraint bypass (disabled/maxlength removed, app misbehaves)',
        severity: 'HIGH',
        evidence: {
          message: `Stripped client-side constraints for ${ctx.element.selector}. Injected payload begins: ${payload.slice(0, 80)}...`,
          selector: ctx.element.selector,
          actionExecuted: 'client-side-constraint-bypass',
          stateHash: ctx.stateHash,
        },
      },
    ];
  },
};


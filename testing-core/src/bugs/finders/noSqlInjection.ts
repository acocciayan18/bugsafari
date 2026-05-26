import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { fuzzTextWithAttackSurface } from '../scenarioAdapters.js';

export const noSqlInjectionFinder: BugFinder = {
  bugClass: 'NOSQL_INJECTION',

  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;

    if (['INPUT', 'LOGIN'].includes(el.semanticRole)) {
      const clues = `${el.type} ${el.name} ${el.text} ${el.id} ${el.className}`.toLowerCase();
      return /(search|query|filter|email|username|account|id)/.test(clues);
    }

    return false;
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    if (!ctx.element) {
      return [];
    }

    const payload = await fuzzTextWithAttackSurface(ctx.page, ctx.element, ctx.step, {
      profile: 'xss_sql_unicode',
    });

    const finding: BugFinding = {
      bugClass: 'NOSQL_INJECTION',
      title: 'NoSQL injection pattern may be mishandled (e.g., $gt/$ne JSON fragments)',
      severity: 'HIGH',
      evidence: {
        message: `Injected mutated payload aiming at NoSQL operators into ${ctx.element.selector}. Payload prefix: ${payload.slice(0, 80)}...`,
        selector: ctx.element.selector,
        actionExecuted: 'fuzz-nosql-injection',
        stateHash: ctx.stateHash,
      },
    };

    return [finding];
  },
};


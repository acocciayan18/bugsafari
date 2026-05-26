import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { fuzzTextWithAttackSurface } from '../scenarioAdapters.js';

export const inputSanitizationFinder: BugFinder = {
  bugClass: 'INPUT_SANITIZATION_FAILURE',

  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;
    return ['INPUT', 'LOGIN'].includes(el.semanticRole);
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    if (!ctx.element) return [];

    const payload = await fuzzTextWithAttackSurface(ctx.page, ctx.element, ctx.step, {
      profile: 'xss_sql_unicode',
    });

    return [
      {
        bugClass: 'INPUT_SANITIZATION_FAILURE',
        title: 'Input sanitization failure (mutated payloads: XSS fragments / unicode/Zalgo / injection strings)',
        severity: 'MEDIUM',
        evidence: {
          message: `Injected mutated payload into ${ctx.element.selector}. Payload begins: ${payload.slice(0, 80)}...`,
          selector: ctx.element.selector,
          actionExecuted: 'input-sanitization-fuzz',
          stateHash: ctx.stateHash,
        },
      },
    ];
  },
};


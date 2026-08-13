import type { Page, Response } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { fuzzTextWithAttackSurface } from '../scenarioAdapters.js';
import { matchesCategory } from '../knowledgeBase/signalPatterns.js';
import { isInjectableTarget } from './injectionSuitability.js';
import { setFieldValue } from '../../domain/services/exploration/frameworkInput.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { describeTarget, elementNoun, resolveElementLabel } from '../../../../shared/reproduction.js';

// Time allowed for the backend to answer the injected input before we judge it.
const OBSERVE_WINDOW_MS = 1200;

// Fields already probed this run — one injection attempt per field is enough. Lets the
// finder run 'transactional' (every step the field is the acted element) without
// re-fuzzing a field it already tested. Mirrors the differential oracle's guard.
const attemptedSelectors = new Set<string>();

/** Clear the per-run attempt log. Called at the start of each exploration run. */
export function resetNoSqlInjectionFinder(): void {
  attemptedSelectors.clear();
}

interface InjectionEvidence {
  serverFault?: { status: number; url: string };
  operatorLeak?: string;
}

/** Captures backend responses and console output while the payload is processed. */
async function observeInjection(page: Page, inject: () => Promise<string>): Promise<{
  payload: string;
  evidence: InjectionEvidence;
}> {
  const evidence: InjectionEvidence = {};

  const onResponse = (response: Response): void => {
    if (response.status() >= 500 && !evidence.serverFault) {
      evidence.serverFault = { status: response.status(), url: response.url() };
    }
  };
  const onConsole = (message: { text(): string }): void => {
    const text = message.text();
    if (!evidence.operatorLeak && matchesCategory('NOSQL_ERROR', text)) {
      evidence.operatorLeak = text.slice(0, 300);
    }
  };

  page.on('response', onResponse);
  page.on('console', onConsole);
  try {
    const payload = await inject();
    await page.waitForTimeout(OBSERVE_WINDOW_MS);

    if (!evidence.operatorLeak) {
      const body = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) ?? '').catch(() => '');
      if (matchesCategory('NOSQL_ERROR', body)) {
        evidence.operatorLeak = body.slice(0, 300);
      }
    }
    return { payload, evidence };
  } finally {
    page.off('response', onResponse);
    page.off('console', onConsole);
  }
}

export const noSqlInjectionFinder: BugFinder = {
  bugClass: 'NOSQL_INJECTION',
  testingType: 'dataFuzzing',
  // Runs the first step the field is the acted element, not only on the sweep cadence —
  // the per-field guard below keeps it one-shot so it never re-fuzzes a tested field.
  frequency: 'transactional',

  // Role check is inlined rather than importing inferSemanticRole from
  // exploration/types: that module transitively imports this tree via ActionExecutor.
  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;
    if (el.tagName !== 'input' && el.tagName !== 'select' && el.tagName !== 'textarea') return false;
    if (attemptedSelectors.has(el.selector)) return false;

    return isInjectableTarget(el);
  },

  /**
   * Injects Mongo operator fragments and reports ONLY on observed mishandling —
   * a 5xx answer or a leaked driver/operator error. Injecting a payload is not
   * itself a finding; without one of those signals the target handled it correctly.
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const element = ctx.element;
    if (!element) return [];
    attemptedSelectors.add(element.selector);

    // fuzzTextWithAttackSurface strips form constraints and returns a deterministic
    // payload but does NOT deliver it; type it into the field and submit so the backend
    // actually processes the operator and the observe window can see the response.
    const { payload, evidence } = await observeInjection(ctx.page, async () => {
      const value = await fuzzTextWithAttackSurface(ctx.page, element, ctx.step, { profile: 'xss_sql_unicode' });
      const delivered = await setFieldValue(ctx.page, element.selector, value);
      if (delivered.delivered) await triggerFormSubmission(ctx.page, element.selector);
      return value;
    });

    if (!evidence.serverFault && !evidence.operatorLeak) return [];

    const detail = evidence.operatorLeak
      ? `The server returned a raw NoSQL database error: "${evidence.operatorLeak}"`
      : `The server returned status ${evidence.serverFault?.status} at ${evidence.serverFault?.url}`;

    return [
      {
        bugClass: 'NOSQL_INJECTION',
        // A leaked operator error is direct evidence the fragment reached the query;
        // a 5xx alone only proves the input was not handled safely.
        severity: evidence.operatorLeak ? 'CRITICAL' : 'HIGH',
        title: 'Database operator was not handled safely by the server',
        evidence: {
          message: `${detail}. This value went into ${describeTarget(resolveElementLabel(element), elementNoun(element.tagName, element.type))}, and the operator reached the database instead of being treated as plain text. Value sent (start): ${payload.slice(0, 80)}`,
          selector: element.selector,
          actionExecuted: 'fuzz-nosql-injection',
          stateHash: ctx.stateHash,
          statusCode: evidence.serverFault?.status,
        },
      },
    ];
  },
};

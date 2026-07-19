import type { Page, Response } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { fuzzTextWithAttackSurface } from '../scenarioAdapters.js';
import { matchesCategory } from '../knowledgeBase/signalPatterns.js';

// Text-bearing controls whose value plausibly reaches a Mongo query.
const QUERYABLE_CLUE_RE = /(search|query|filter|email|username|account|id)/;

// Time allowed for the backend to answer the injected input before we judge it.
const OBSERVE_WINDOW_MS = 1200;

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

  // Role check is inlined rather than importing inferSemanticRole from
  // exploration/types: that module transitively imports this tree via ActionExecutor.
  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;
    if (el.tagName !== 'input' && el.tagName !== 'select' && el.tagName !== 'textarea') return false;

    const clues = `${el.type} ${el.innerText} ${el.id} ${el.className}`.toLowerCase();
    return QUERYABLE_CLUE_RE.test(clues);
  },

  /**
   * Injects Mongo operator fragments and reports ONLY on observed mishandling —
   * a 5xx answer or a leaked driver/operator error. Injecting a payload is not
   * itself a finding; without one of those signals the target handled it correctly.
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const element = ctx.element;
    if (!element) return [];

    const { payload, evidence } = await observeInjection(ctx.page, () =>
      fuzzTextWithAttackSurface(ctx.page, element, ctx.step, { profile: 'xss_sql_unicode' }),
    );

    if (!evidence.serverFault && !evidence.operatorLeak) return [];

    const detail = evidence.operatorLeak
      ? `Backend leaked a NoSQL driver/operator error: "${evidence.operatorLeak}"`
      : `Backend answered ${evidence.serverFault?.status} at ${evidence.serverFault?.url}`;

    return [
      {
        bugClass: 'NOSQL_INJECTION',
        // A leaked operator error is direct evidence the fragment reached the query;
        // a 5xx alone only proves the input was not handled safely.
        severity: evidence.operatorLeak ? 'CRITICAL' : 'HIGH',
        title: 'NoSQL operator fragment mishandled by the backend',
        evidence: {
          message: `${detail}. Injected into ${element.selector}. Payload prefix: ${payload.slice(0, 80)}`,
          selector: element.selector,
          actionExecuted: 'fuzz-nosql-injection',
          stateHash: ctx.stateHash,
          statusCode: evidence.serverFault?.status,
        },
      },
    ];
  },
};

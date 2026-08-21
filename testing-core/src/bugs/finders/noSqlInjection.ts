import type { Page, Response } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { fuzzTextWithAttackSurface } from '../scenarioAdapters.js';
import { matchesCategory } from '../knowledgeBase/signalPatterns.js';
import { isInjectableTarget } from './injectionSuitability.js';
import { setFieldValue } from '../../domain/services/exploration/frameworkInput.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { describeTarget } from '../../../../shared/reproduction.js';
import {
  buildInjectionEvidence,
  correlates,
  resolveSubmissionTarget,
  safeOrigin,
  safePathname,
  type SubmissionTarget,
} from './injectionEvidence.js';

// Time allowed for the backend to answer the injected input before we judge it.
const OBSERVE_WINDOW_MS = 1200;
// Cap on the extracted driver-error snippet — the real error line, not the whole page.
const MAX_ERROR_SNIPPET = 200;

// Name an injected payload by its SHAPE (not a vuln class) so the finding message states
// what was actually submitted — a bare `'` is a SQL metacharacter, not a NoSQL operator.
export function describeInjectedValue(payload: string): string {
  const p = payload ?? '';
  if (/\$(?:ne|gt|gte|lt|lte|in|nin|where|regex|exists|or|and)\b/i.test(p) || /^\s*[{[]/.test(p)) return 'a NoSQL operator';
  if (/['"]|--|;|\b(?:or|union|select)\b/i.test(p)) return 'a SQL metacharacter';
  if (/<\s*(?:script|svg|img)\b|on\w+\s*=|javascript:|<</i.test(p)) return 'an HTML/script fragment';
  return 'an unexpected value';
}

// A field accepting text or special characters is not injection; the DELIVERED payload
// must carry an operator/metacharacter for a leaked driver error to be attributable to it.
// A blank or benign value (nothing but 'an unexpected value') can never confirm this finder.
export function carriesAttackSurface(payload: string): boolean {
  return Boolean(payload?.trim()) && describeInjectedValue(payload) !== 'an unexpected value';
}

// Fields already probed this run — one injection attempt per field is enough. Lets the
// finder run 'transactional' (every step the field is the acted element) without
// re-fuzzing a field it already tested. Mirrors the differential oracle's guard.
const attemptedSelectors = new Set<string>();

/** Clear the per-run attempt log. Called at the start of each exploration run. */
export function resetNoSqlInjectionFinder(): void {
  attemptedSelectors.clear();
}

interface InjectionEvidence {
  serverFault?: { status: number; url: string; method: string };
  // The extracted driver-error line ONLY — never raw page text or the reflected payload.
  operatorLeak?: string;
  responseUrl?: string;
  method?: string;
  statusCode?: number;
}

// Fire ONLY on a genuine datastore-error signature. A bare 5xx (input-validation crash on a
// malformed payload) is NOT injection evidence — it stays a SERVER_API_FAILURE — so serverFault
// alone never confirms NoSQL injection. Prevents a false positive on any endpoint that 500s on bad input.
export function isNosqlInjectionConfirmed(evidence: Pick<InjectionEvidence, 'operatorLeak'>): boolean {
  return Boolean(evidence.operatorLeak);
}

// Remove every occurrence of the injected value so a payload reflected back into the
// response can never be mistaken for a driver error, then return the first line that
// carries a genuine NoSQL signature. undefined when only the reflection matched.
function extractNosqlError(text: string, payload: string): string | undefined {
  // No payload to strip means a match cannot be told apart from a reflected/static
  // error, so it is never attributable to injection — bail instead of matching raw text.
  if (!text || !payload) return undefined;
  const cleaned = text.split(payload).join(' ');
  if (!matchesCategory('NOSQL_ERROR', cleaned)) return undefined;
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && matchesCategory('NOSQL_ERROR', trimmed)) return trimmed.slice(0, MAX_ERROR_SNIPPET);
  }
  return cleaned.trim().slice(0, MAX_ERROR_SNIPPET);
}

/** Captures backend responses and console output while the payload is processed. */
async function observeInjection(
  page: Page,
  target: SubmissionTarget,
  origin: string,
  inject: () => Promise<string>,
): Promise<{ payload: string; evidence: InjectionEvidence }> {
  const evidence: InjectionEvidence = {};
  const responses: Array<{ status: number; url: string; method: string; text: string }> = [];
  const consoleTexts: string[] = [];
  const pending: Promise<void>[] = [];

  const onResponse = (response: Response): void => {
    if (response.status() >= 500 && !evidence.serverFault) {
      evidence.serverFault = { status: response.status(), url: response.url(), method: response.request().method() };
    }
    // Capture correlated same-origin API/document bodies so a genuine driver error in
    // the SERVER's answer is matched, not the payload reflected back into the page.
    if (!correlates(response, '', target, origin)) return;
    const status = response.status();
    const url = response.url();
    const method = response.request().method();
    pending.push(response.text().then((text) => { responses.push({ status, url, method, text }); }, () => undefined));
  };
  const onConsole = (message: { text(): string }): void => { consoleTexts.push(message.text()); };

  page.on('response', onResponse);
  page.on('console', onConsole);
  try {
    const payload = await inject();
    await page.waitForTimeout(OBSERVE_WINDOW_MS);
    await Promise.allSettled(pending);

    // A driver error in a correlated response body carries the endpoint too.
    for (const r of responses) {
      const err = extractNosqlError(r.text, payload);
      if (err) {
        evidence.operatorLeak = err;
        evidence.responseUrl = r.url;
        evidence.method = r.method;
        evidence.statusCode = r.status;
        break;
      }
    }
    if (!evidence.operatorLeak) {
      for (const text of consoleTexts) {
        const err = extractNosqlError(text, payload);
        if (err) { evidence.operatorLeak = err; break; }
      }
    }
    // DOM fallback only when nothing leaked on the wire, likewise payload-stripped.
    if (!evidence.operatorLeak) {
      const body = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) ?? '').catch(() => '');
      const err = extractNosqlError(body, payload);
      if (err) evidence.operatorLeak = err;
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
   * a 5xx answer or a leaked driver/operator error extracted from the server's own
   * response (payload stripped first, so a reflected payload is never misread as an
   * error). Injecting a payload is not itself a finding.
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const element = ctx.element;
    if (!element) return [];
    attemptedSelectors.add(element.selector);

    const origin = safeOrigin(ctx.targetUrl);
    const target = await resolveSubmissionTarget(ctx.page, element.selector);

    // fuzzTextWithAttackSurface strips form constraints and returns a deterministic
    // payload but does NOT deliver it; type it into the field and submit so the backend
    // actually processes the operator and the observe window can see the response.
    const { payload, evidence } = await observeInjection(ctx.page, target, origin, async () => {
      const value = await fuzzTextWithAttackSurface(ctx.page, element, ctx.step, { profile: 'xss_sql_unicode' });
      const delivered = await setFieldValue(ctx.page, element.selector, value);
      if (delivered.delivered) await triggerFormSubmission(ctx.page, element.selector);
      return value;
    });

    // A field merely accepting the fuzz value is not evidence; unless the payload the
    // fuzzer actually delivered carried an operator/metacharacter, a leak is not
    // attributable to injection. Suppresses the blank/benign-payload false positive.
    if (!carriesAttackSurface(payload)) return [];
    if (!isNosqlInjectionConfirmed(evidence)) return [];

    const responseUrl = evidence.responseUrl ?? evidence.serverFault?.url;
    const method = evidence.method ?? evidence.serverFault?.method;
    const statusCode = evidence.statusCode ?? evidence.serverFault?.status;
    const path = responseUrl ? safePathname(responseUrl) : '';
    const at = path ? ` at ${path}` : '';

    // Server response goes in a separate Observed Result, not the message.
    const observation = `The server returned a NoSQL database error: "${evidence.operatorLeak}"${at}. The operator reached the query engine instead of being treated as text.`;

    const parts = buildInjectionEvidence({ element, payload, faultUrl: ctx.page.url(), observation, method, responseUrl, statusCode });

    return [
      {
        bugClass: 'NOSQL_INJECTION',
        // Only a leaked operator error fires this finder — direct evidence the fragment
        // reached the query engine; a bare 5xx is left to SERVER_API_FAILURE.
        severity: 'CRITICAL',
        title: 'Database operator was not handled safely by the server',
        evidence: {
          message: `${describeTarget(parts.label, parts.noun)} accepted ${describeInjectedValue(payload)} the server did not treat as plain text. Injected value: ${payload}`,
          selector: parts.displaySelector,
          actionExecuted: 'fuzz-nosql-injection',
          stateHash: ctx.stateHash,
          statusCode,
          payload,
          reproductionPlaybook: parts.reproductionPlaybook,
          reproductionActions: parts.reproductionActions,
          specifics: parts.specifics,
          // Structural proof marker: this finder fires only on a matched NOSQL_ERROR signature.
          signals: ['NOSQL_ERROR'],
        },
      },
    ];
  },
};

import type { Page, Response } from 'playwright';
import type { BugClass, BugFinder, BugContext, BugFinding } from '../types.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { setFieldValue } from '../../domain/services/exploration/frameworkInput.js';
import { isInjectableTarget } from './injectionSuitability.js';
import { describeTarget } from '../../../../shared/reproduction.js';
import {
  buildInjectionEvidence,
  correlates,
  resolveSubmissionTarget,
  safeOrigin,
  safePathname,
  type SubmissionTarget,
} from './injectionEvidence.js';

// ═══════════════════════════════════════════════════════════════
// bugs/finders/injectionDifferential.ts — DIFFERENTIAL INJECTION ORACLE
// ═══════════════════════════════════════════════════════════════
// Closes the audit C3 false-negative: the existing noSqlInjection finder only fires
// on a 5xx or a leaked operator error, so the highest-value injection bug — an
// operator payload that CHANGES the result (auth/authorization bypass, or a query
// that returns more data) while the server answers HTTP 200 — was invisible.
//
// This oracle is DIFFERENTIAL and conservative: it submits a benign baseline and an
// operator payload into the same field, correlates each to its own same-origin
// response, and reports ONLY when the operator payload changes the outcome:
//   • baseline rejected/failed (4xx / stayed put) but the operator payload SUCCEEDED
//     (2xx) → the operator was interpreted, not treated as a literal → injection /
//     authorization bypass (CRITICAL);
//   • both 2xx but the operator response returned materially MORE data than the
//     baseline → the operator broadened the query (HIGH).
// A safe backend treats `{"$ne":null}` / `' OR '1'='1` as an ordinary string, so the
// two responses match and nothing is reported — no false positive on a defended app.

// Window (ms) to let each submission's response settle before it is judged.
const OBSERVE_WINDOW_MS = 1200;
// Benign control value — a safe app answers this the same way it answers the operator.
const BENIGN_VALUE = 'bugsafari';
// Operator payloads, each tagged with the datastore class it targets. As a plain string
// these are inert against a safe backend; only an app that INTERPRETS them (object/operator
// coercion, or string-concatenated SQL) reacts. The SQL operator routes to SQL_INJECTION
// (CWE-89), the Mongo operator to NOSQL_INJECTION (CWE-943), so the finding is labelled for
// the backend it actually hit.
const OPERATOR_PAYLOADS: ReadonlyArray<{ value: string; bugClass: Extract<BugClass, 'SQL_INJECTION' | 'NOSQL_INJECTION'> }> = [
  { value: "' OR '1'='1", bugClass: 'SQL_INJECTION' },
  { value: '{"$ne":null}', bugClass: 'NOSQL_INJECTION' },
];
// Data-amplification thresholds: the operator body must be BOTH >3× and >512 bytes
// larger than the baseline before a same-status differential counts as broadened data.
const AMPLIFY_RATIO = 3;
const AMPLIFY_FLOOR_BYTES = 512;
const MAX_BODY_BYTES = 200_000;

interface CorrelatedResponse {
  status: number;
  bodyLen: number;
  url: string;
  method: string;
}

// Submit `value` into the field and capture the first correlated same-origin response.
async function submitAndCapture(
  page: Page,
  selector: string,
  value: string,
  target: SubmissionTarget,
  origin: string,
): Promise<CorrelatedResponse | null> {
  const captured: { hit: CorrelatedResponse | null } = { hit: null };
  const pending: Promise<void>[] = [];
  const onResponse = (response: Response): void => {
    if (captured.hit) return;
    if (!correlates(response, value, target, origin)) return;
    const method = response.request().method();
    pending.push(
      response
        .text()
        .then((text) => {
          if (!captured.hit) captured.hit = { status: response.status(), bodyLen: Math.min(text.length, MAX_BODY_BYTES), url: response.url(), method };
        })
        .catch(() => {
          if (!captured.hit) captured.hit = { status: response.status(), bodyLen: 0, url: response.url(), method };
        }),
    );
  };

  page.on('response', onResponse);
  try {
    const delivered = await setFieldValue(page, selector, value);
    if (!delivered.delivered) return null;
    await triggerFormSubmission(page, selector);
    await page.waitForTimeout(OBSERVE_WINDOW_MS);
    await Promise.allSettled(pending);
  } catch {
    return null;
  } finally {
    page.off('response', onResponse);
  }
  return captured.hit;
}

// Fields already probed this run — one differential pair per field is enough.
const attemptedSelectors = new Set<string>();

/** Clear the per-run attempt log. Called at the start of each exploration run. */
export function resetInjectionDifferentialFinder(): void {
  attemptedSelectors.clear();
}

function isAuthBypass(baseline: CorrelatedResponse, operator: CorrelatedResponse): boolean {
  const baselineFailed = baseline.status >= 400;
  const operatorOk = operator.status >= 200 && operator.status < 300;
  return baselineFailed && operatorOk;
}

function isDataAmplification(baseline: CorrelatedResponse, operator: CorrelatedResponse): boolean {
  const bothOk = baseline.status < 300 && operator.status < 300 && baseline.status >= 200 && operator.status >= 200;
  return (
    bothOk &&
    operator.bodyLen > baseline.bodyLen * AMPLIFY_RATIO &&
    operator.bodyLen - baseline.bodyLen > AMPLIFY_FLOOR_BYTES
  );
}

export const injectionDifferentialFinder: BugFinder = {
  bugClass: 'NOSQL_INJECTION',
  testingType: 'dataFuzzing',
  // Runs the first step the field is the acted element, not only on the sweep cadence —
  // attemptedSelectors keeps it one differential pair per field.
  frequency: 'transactional',

  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;
    if (el.tagName !== 'input' && el.tagName !== 'textarea') return false;
    if (attemptedSelectors.has(el.selector)) return false;
    return isInjectableTarget(el);
  },

  /**
   * Submit a benign baseline, then each operator payload, into the same field and
   * report ONLY on a strict positive differential (auth bypass or data broadening).
   * The page URL is restored between attempts so the finder never strands the loop
   * on a different route than the state it was invoked on.
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const element = ctx.element;
    if (!element) return [];
    attemptedSelectors.add(element.selector);

    const origin = safeOrigin(ctx.targetUrl);
    const urlBefore = ctx.page.url();
    const target = await resolveSubmissionTarget(ctx.page, element.selector);

    const restore = async (): Promise<void> => {
      if (ctx.page.isClosed()) return;
      if (ctx.page.url() !== urlBefore) {
        await ctx.page.goto(urlBefore, { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => undefined);
      }
    };

    const baseline = await submitAndCapture(ctx.page, element.selector, BENIGN_VALUE, target, origin);
    if (!baseline) {
      await restore();
      return []; // nothing correlated → cannot judge a differential
    }

    for (const { value: payload, bugClass } of OPERATOR_PAYLOADS) {
      await restore();
      // The field must still exist on the restored view to submit the operator.
      const present = await ctx.page.$(element.selector).then((el) => el !== null).catch(() => false);
      if (!present) break;

      const operator = await submitAndCapture(ctx.page, element.selector, payload, target, origin);
      if (!operator) continue;

      const authBypass = isAuthBypass(baseline, operator);
      const amplified = !authBypass && isDataAmplification(baseline, operator);
      if (!authBypass && !amplified) continue;

      await restore();
      const kind = bugClass === 'SQL_INJECTION' ? 'SQL' : 'NoSQL';
      const path = safePathname(operator.url);
      // Server-response differential — a separate Observed Result (split out by the dashboard).
      const observation = authBypass
        ? `A normal value "${BENIGN_VALUE}" was rejected (HTTP ${baseline.status}) but the ${kind} operator value was accepted (HTTP ${operator.status}) at ${path}. The server executed the operator instead of treating it as text.`
        : `Both values were accepted (HTTP ${operator.status}) at ${path}, but the ${kind} operator value grew the response from ${baseline.bodyLen} to ${operator.bodyLen} bytes. It widened the query and returned more data than it should.`;
      const parts = buildInjectionEvidence({
        element,
        payload,
        faultUrl: ctx.page.url(),
        observation,
        method: operator.method,
        responseUrl: operator.url,
        statusCode: operator.status,
      });

      const message = authBypass
        ? `${describeTarget(parts.label, parts.noun)} accepted a ${kind} operator value the server executed instead of treating as text, which can bypass the login or authorization check. Injected value: ${payload}`
        : `${describeTarget(parts.label, parts.noun)} accepted a ${kind} operator value that widened the query and returned more data than a normal value. Injected value: ${payload}`;

      return [
        {
          bugClass,
          severity: authBypass ? 'CRITICAL' : 'HIGH',
          title: authBypass
            ? `${kind} operator value slipped past the server checks`
            : `${kind} operator value returned more data than expected`,
          evidence: {
            message,
            selector: parts.displaySelector,
            actionExecuted: 'injection-differential',
            stateHash: ctx.stateHash,
            statusCode: operator.status,
            payload,
            reproductionPlaybook: parts.reproductionPlaybook,
            reproductionActions: parts.reproductionActions,
            specifics: parts.specifics,
          },
        },
      ];
    }

    await restore();
    return [];
  },
};

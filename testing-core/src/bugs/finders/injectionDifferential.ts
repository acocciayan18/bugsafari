import type { Page, Response } from 'playwright';
import type { BugClass, BugFinder, BugContext, BugFinding } from '../types.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { setFieldValue } from '../../domain/services/exploration/frameworkInput.js';
import { isInjectableTarget } from './injectionSuitability.js';
import { deriveFuzzSeed } from '../../domain/scenarios/fuzzing/payloadEscalator.js';
import { currentFuzzRunSeed } from '../../domain/scenarios/fuzzing/runFuzzSeed.js';
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

// Upper bound (ms) on waiting for a submission's correlated response. Replaces the
// old flat 1200ms wait: the capture now resolves the instant the correlated response
// body settles (fast backends judged immediately) but will wait this long for a slow
// one — a cold start or a slow query is exactly the boundary condition being probed,
// and a fixed short wait dropped it as "no response" (audit FN-3). Env-tunable.
const RESPONSE_WAIT_CAP_MS = (() => {
  const n = Number(process.env.BUGSAFARI_INJECTION_WAIT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8000;
})();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// Benign control value — a safe app answers this the same way it answers the operator.
const BENIGN_VALUE = 'bugsafari';
// Operator payloads, each tagged with the datastore class it targets. As a plain string
// these are inert against a safe backend; only an app that INTERPRETS them (object/operator
// coercion, or string-concatenated SQL) reacts. The SQL operator routes to SQL_INJECTION
// (CWE-89), the Mongo operator to NOSQL_INJECTION (CWE-943), so the finding is labelled for
// the backend it actually hit.
type OperatorClass = Extract<BugClass, 'SQL_INJECTION' | 'NOSQL_INJECTION'>;

// Rotation pools — one SQL + one NoSQL operator picked per field per run so different
// runs/retests exercise different operators instead of re-firing one constant. Every entry
// carries attack surface and stays inert-as-text on a safe backend.
const SQL_OPERATORS: readonly string[] = ["' OR '1'='1", "' OR '1'='1' --", "admin'--", "' OR 1=1--"];
const NOSQL_OPERATORS: readonly string[] = ['{"$ne":null}', '{"$gt":""}', '{"$ne":""}', '{"$regex":".*"}'];

// Deterministic per-(selector, run) rotation offset: stable within a run (replayable),
// varied across runs via the run salt. Orders the pool so the run's lead operator is
// tried first, then the rest — a vuln that trips only on a non-lead operator ($where
// vs $ne) is no longer missed within a single run (audit FN-3).
function rotatePool(pool: readonly string[], selector: string): string[] {
  const offset = ((deriveFuzzSeed(selector, 'DATABASE_AUTH') ^ currentFuzzRunSeed()) >>> 0) % pool.length;
  return pool.map((_, i) => pool[(offset + i) % pool.length]);
}

// Build this field's differential attempts: the WHOLE SQL + NoSQL pools, rotation-ordered,
// interleaved so each datastore class gets its strongest shot early. One-shot per field and
// the run loop stops on the first positive differential, so a defended app still costs the
// baseline + a bounded operator sweep and reports nothing.
export function selectOperatorPayloads(selector: string): ReadonlyArray<{ value: string; bugClass: OperatorClass }> {
  const sql = rotatePool(SQL_OPERATORS, selector);
  const nosql = rotatePool(NOSQL_OPERATORS, selector);
  const attempts: { value: string; bugClass: OperatorClass }[] = [];
  for (let i = 0; i < Math.max(sql.length, nosql.length); i++) {
    if (i < sql.length) attempts.push({ value: sql[i], bugClass: 'SQL_INJECTION' });
    if (i < nosql.length) attempts.push({ value: nosql[i], bugClass: 'NOSQL_INJECTION' });
  }
  return attempts;
}
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
  // Resolved the instant the first correlated response body settles, so a responsive
  // backend is judged without burning the full cap; a slow one waits up to the cap.
  let settle: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  const onResponse = (response: Response): void => {
    if (captured.hit) return;
    if (!correlates(response, value, target, origin)) return;
    const method = response.request().method();
    response
      .text()
      .then((text) => {
        if (!captured.hit) captured.hit = { status: response.status(), bodyLen: Math.min(text.length, MAX_BODY_BYTES), url: response.url(), method };
      })
      .catch(() => {
        if (!captured.hit) captured.hit = { status: response.status(), bodyLen: 0, url: response.url(), method };
      })
      .finally(() => settle());
  };

  page.on('response', onResponse);
  try {
    const delivered = await setFieldValue(page, selector, value);
    if (!delivered.delivered) return null;
    await triggerFormSubmission(page, selector);
    await Promise.race([settled, sleep(RESPONSE_WAIT_CAP_MS)]);
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

// Behavioral evidence, not presence: the operator is judged injection ONLY when it CHANGES
// the server's answer. A field that merely accepts special characters (baseline and operator
// answer identically) is never flagged — the differential is empty, so both predicates fail.
export function isAuthBypass(baseline: CorrelatedResponse, operator: CorrelatedResponse): boolean {
  const baselineFailed = baseline.status >= 400;
  const operatorOk = operator.status >= 200 && operator.status < 300;
  return baselineFailed && operatorOk;
}

export function isDataAmplification(baseline: CorrelatedResponse, operator: CorrelatedResponse): boolean {
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

    for (const { value: payload, bugClass } of selectOperatorPayloads(element.selector)) {
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

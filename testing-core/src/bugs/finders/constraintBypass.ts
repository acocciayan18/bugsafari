import type { Page, Response } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { humanizeElement, resolveElementLabel } from '../../../../shared/reproduction.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveMaskedFailure, isProxyGatewayArtifact, MAX_SOFT_FAIL_BODY_BYTES } from '../../domain/services/verification/softFailBody.js';
import { matchesCategory } from '../knowledgeBase/signalPatterns.js';

// Rapid-click / concurrency stress windows. While one runs, a state-changing 2xx firing
// in the observation window is far more likely a burst-provoked autosave/telemetry write
// than a bypassed constraint — probing here manufactured a Client-Side Constraint Bypass
// out of a Concurrent Stress Burst. The finding is owned by the runtime/race evidence instead.
const BURST_SCENARIOS: readonly string[] = ['ButtonSpammer', 'CoordinateBombing', 'AsyncStateRacer', 'ConcurrentClicker'];

function isBurstScenarioActive(): boolean {
  const scenario = ActiveScenarioTracker.getActiveScenarioName();
  return scenario !== undefined && BURST_SCENARIOS.some((name) => scenario.includes(name));
}

// Window (ms) to let the submitted request settle so its response can be judged.
const OBSERVE_WINDOW_MS = 1200;

// A maxlength is only an ENFORCEABLE gate within a plausible range. A nominal placeholder
// like maxlength=999999 caps nothing real, so exceeding it proves nothing — probing it
// manufactured a CWE-602 out of a free-text field. At/above this bound the constraint is
// treated as absent and the field is never probed.
const MAX_ENFORCEABLE_MAXLENGTH = 10000;

interface ViolationPlan {
  violating: string;
  constraint: string;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// Domain-stripped request path (pathname + query) for developer-facing evidence.
function relativeEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

// Longest payload rendered inline in the finding MESSAGE prose. An amplification blob (a
// near-cap maxlength value is thousands of chars) must not bloat the sentence — the full
// value stays in the bypass detail grid and the reproduction step.
const MAX_MESSAGE_PAYLOAD = 80;

// Prose form of the submitted value — empty string reads as an explicit phrase; an
// over-long value is truncated with a factual length note, never rendered in full.
export function describePayload(value: string): string {
  if (value === '') return 'an empty value';
  if (value.length <= MAX_MESSAGE_PAYLOAD) return `"${value}"`;
  return `"${value.slice(0, MAX_MESSAGE_PAYLOAD)}…" (${value.length} chars, full value in evidence)`;
}

function sameOrigin(url: string, origin: string): boolean {
  return origin !== '' && safeOrigin(url) === origin;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * What the fuzzed field's submission is expected to hit. Without this the finder
 * accepted the FIRST state-changing 2xx in the observation window — a concurrent
 * autosave or telemetry write manufactured a CLIENT_SIDE_CONSTRAINT_BYPASS.
 */
interface SubmissionTarget {
  /** Pathname of the parent form's resolved action, or null for a formless/SPA field. */
  actionPath: string | null;
  /** The field's wire name (`name`, else `id`), or null when it has neither. */
  fieldName: string | null;
}

async function resolveSubmissionTarget(page: Page, selector: string): Promise<SubmissionTarget> {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return { actionPath: null, fieldName: null };
      const form = el.closest('form');
      const action = form ? form.getAttribute('action') ?? location.href : null;
      return {
        actionPath: action ? new URL(action, location.href).pathname : null,
        fieldName: el.getAttribute('name') || el.id || null,
      };
    }, selector)
    .catch(() => ({ actionPath: null, fieldName: null }));
}

/**
 * Is this response the answer to OUR submission? Accepted only on positive
 * evidence: the request body carries the payload we injected, it carries the
 * field's own name, or it went to the parent form's action. A response that
 * satisfies none of these is unrelated traffic and is ignored.
 */
export function correlatesToSubmission(body: string, url: string, payload: string, target: SubmissionTarget): boolean {
  if (payload !== '' && (body.includes(payload) || body.includes(encodeURIComponent(payload)))) return true;
  if (target.fieldName !== null && body.includes(target.fieldName)) return true;
  return target.actionPath !== null && safePathname(url) === target.actionPath;
}

// The observable adverse effect a stripped-constraint submission produced. Absent ⇒ the
// value was accepted harmlessly (or correctly rejected), which is NOT a reportable bypass.
interface ProvenEffect {
  kind: 'server-error' | 'client-error';
  detail: string;
  status: number;
  url: string;
  method: string;
}

interface CorrelatedHit {
  status: number;
  url: string;
  method: string;
  response: Response;
}

/**
 * Impact oracle. A bypass is reportable ONLY when the invalid value caused a meaningful
 * effect, never because the server merely returned 2xx. Effects, in order:
 *  - a correlated 5xx (server crash/error from the value; edge/tunnel 5xx excluded),
 *  - a correlated 2xx masking a backend failure (leaked stack / declared error, minus the
 *    normal-GraphQL and expected-rejection suppressions — see resolveMaskedFailure),
 *  - a correlated 2xx (server accepted it) paired with an unhandled client exception the
 *    value then triggered (crash/freeze).
 * A silent benign 2xx, a correlated 4xx (correct rejection), or a lone client error with no
 * server acceptance yields null → the finding is discarded as a false positive.
 */
// Pure server-effect classifier for a correlated response body. A 5xx (server crash from the
// value; edge/tunnel 5xx excluded) or a <400 body masking a backend failure (leaked stack /
// declared error, minus the normal-GraphQL and expected-rejection suppressions) returns the
// human detail. A benign 2xx or a 4xx rejection returns null — the server handled it safely.
export function serverEffectDetail(status: number, url: string, body: string): string | null {
  if (status >= 500 && !isProxyGatewayArtifact(status, body)) return `errored (HTTP ${status})`;
  if (status < 400) {
    const serverSignature = body.length <= MAX_SOFT_FAIL_BODY_BYTES && matchesCategory('SERVER_ERROR', body);
    const masked = resolveMaskedFailure({ url, body, serverSignature });
    if (masked.softFail) return `masked a backend failure (${masked.matched})`;
  }
  return null;
}

async function resolveEffect(hit: CorrelatedHit | null, clientError: string | null): Promise<ProvenEffect | null> {
  if (!hit) return null; // no correlated server response ⇒ not attributable to a server-side bypass
  let body = '';
  try {
    body = (await hit.response.text()).slice(0, MAX_SOFT_FAIL_BODY_BYTES);
  } catch {
    body = '';
  }
  const base = { status: hit.status, url: hit.url, method: hit.method };
  const serverDetail = serverEffectDetail(hit.status, hit.url, body);
  if (serverDetail) return { kind: 'server-error', detail: serverDetail, ...base };
  // A server-accepted (2xx) value that then crashed the client is a client-side effect.
  if (hit.status < 400 && clientError) return { kind: 'client-error', detail: clientError, ...base };
  return null; // accepted harmlessly, or a correlated 4xx = correct rejection
}

// Data-type constraint from the parse-time snapshot, so it survives an earlier action
// stripping the live DOM attributes. Only type=number qualifies: a data contract whose
// non-numeric input probes backend type handling. Textual format hints (type=email,
// type=url) are re-parsed server-side by design — a bad value drawing a 2xx error body
// (e.g. a failed login) is indistinguishable from acceptance, so flagging them was a
// CWE-602 false positive and they are excluded. Matches the catalog rule set
// (required/disabled/maxlength), which never included browser format types.
export function planFromType(element: InteractiveElement): ViolationPlan | null {
  switch ((element.type || '').toLowerCase()) {
    case 'number':
      return { violating: 'x-not-a-number', constraint: 'type=number' };
    default:
      return null;
  }
}

// A field's still-present client constraints, read as plain data so the plan can be
// derived in Node. maxLength is null when absent/invalid; pattern null when absent.
export interface ConstraintSnapshot {
  maxLength: number | null;
  pattern: string | null;
  required: boolean;
}

// Reads the LIVE DOM. Fires only when the constraints are still present (an unfuzzed
// field), so it never guesses a gate that isn't there. No checkValidity: maxlength
// (tooLong) only trips on USER-edited values, so a scripted over-length value passes
// checkValidity and the browser can't confirm the violation — the snapshot lets Node
// prove it instead.
async function readConstraintSnapshot(page: Page, selector: string): Promise<ConstraintSnapshot | null> {
  return page
    .$eval(
      selector,
      (node, cap) => {
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return null;
        const maxLen = parseInt(node.getAttribute('maxlength') || '', 10);
        return {
          maxLength: Number.isFinite(maxLen) && maxLen > 0 && maxLen < cap ? maxLen : null,
          pattern: node.getAttribute('pattern'),
          required: node.hasAttribute('required'),
        };
      },
      MAX_ENFORCEABLE_MAXLENGTH,
    )
    .catch(() => null);
}

// Parse-time constraints captured on the element, so a violation can be planned from the
// value the field HAD even after a preceding fuzz action strips the live DOM (the sweep
// runs post-action). Returns null when the element carries no such constraint.
export function snapshotFromElement(element: InteractiveElement): ConstraintSnapshot | null {
  const maxLength =
    typeof element.maxLength === 'number' && element.maxLength > 0 && element.maxLength < MAX_ENFORCEABLE_MAXLENGTH ? element.maxLength : null;
  const pattern = element.pattern && element.pattern !== '' ? element.pattern : null;
  const required = element.required === true;
  if (maxLength === null && pattern === null && !required) return null;
  return { maxLength, pattern, required };
}

// Pure violation planner: picks the first constraint whose violation is PROVABLE without
// the browser. Priority pattern → maxlength → required (first applicable wins).
export function planFromSnapshot(snapshot: ConstraintSnapshot | null): ViolationPlan | null {
  if (!snapshot) return null;
  if (snapshot.pattern) {
    const candidate = '!bypass 123!';
    let violatesPattern = false;
    try {
      violatesPattern = !new RegExp(`^(?:${snapshot.pattern})$`).test(candidate);
    } catch {
      violatesPattern = true; // unparseable pattern — the browser would still gate it client-side
    }
    if (violatesPattern) return { violating: candidate, constraint: `pattern=${snapshot.pattern}` };
  }
  if (snapshot.maxLength !== null) {
    return { violating: 'A'.repeat(snapshot.maxLength + 32), constraint: `maxlength=${snapshot.maxLength}` };
  }
  if (snapshot.required) return { violating: '', constraint: 'required' };
  return null;
}

// Strip the client constraints so the violating value can leave the browser, then set it.
async function stripAndInject(page: Page, selector: string, violating: string): Promise<void> {
  await page
    .evaluate(
      ({ sel, v }) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return;
        for (const a of ['required', 'maxlength', 'minlength', 'pattern', 'min', 'max']) el.removeAttribute(a);
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'email' || type === 'number') el.setAttribute('type', 'text');
        // Sibling required fields left empty would block native submission (Enter / submit
        // click), forcing the fragile synthetic-dispatch rung. Fill each with a benign valid
        // value so the enclosing form passes browser validation — the probed field's own
        // violating value is untouched.
        const form = el.closest('form');
        if (form) {
          for (const other of Array.from(form.querySelectorAll('input, textarea, select')) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
            if (other === el || !other.hasAttribute('required') || other.value !== '') continue;
            other.value = other instanceof HTMLInputElement && other.type === 'email' ? 'a@b.co' : 'x';
            other.dispatchEvent(new Event('input', { bubbles: true }));
            other.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { sel: selector, v: violating },
    )
    .catch(() => undefined);
}

/**
 * Confirms client-only validation is unsafe: strips a field's client constraint, submits a
 * value the browser would reject, and reports ONLY when that value causes a meaningful
 * effect on a same-origin state-changing request that CORRELATES to this submission
 * (see {@link correlatesToSubmission} and {@link resolveEffect}) — a server error/crash, a
 * masked backend failure, or an unhandled client crash. A value merely accepted with a
 * benign 2xx, or correctly rejected (4xx), is NOT a finding — acceptance is not impact.
 */
// Fields already probed this run — one submit-and-confirm attempt per field is
// enough, so a re-visited control is a cheap skip instead of re-submitting.
const attemptedSelectors = new Set<string>();

/** Clear the per-run attempt log. Called at the start of each exploration run. */
export function resetConstraintBypassFinder(): void {
  attemptedSelectors.clear();
}

export const constraintBypassFinder: BugFinder = {
  bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
  testingType: 'formBypass',
  // Transactional: considered every applicable step (not cadence-sampled), so a
  // sparsely-visited constrained field is still probed. The per-field guard below
  // keeps the cost to one submit per field per run.
  frequency: 'transactional',

  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    const el = ctx.element;
    if (!el) return false;
    if (el.tagName !== 'input' && el.tagName !== 'textarea') return false;
    // Never probe mid-burst — a concurrent 2xx would be mislabeled a constraint bypass.
    if (isBurstScenarioActive()) return false;
    return !attemptedSelectors.has(el.selector);
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const element = ctx.element;
    if (!element) return [];
    attemptedSelectors.add(element.selector); // one probe per field per run

    // Parse-time snapshot first (survives a fuzz action that stripped the live DOM before
    // this sweep); live DOM read only when the element carried no captured constraint.
    const snapshot = snapshotFromElement(element) ?? (await readConstraintSnapshot(ctx.page, element.selector));
    const plan = planFromType(element) ?? planFromSnapshot(snapshot);
    if (!plan) return []; // no enforceable client constraint → nothing to bypass

    const origin = safeOrigin(ctx.targetUrl);
    // Resolved BEFORE the constraints are stripped, so the form action and field
    // name are read while the DOM still reflects the untouched control.
    const target = await resolveSubmissionTarget(ctx.page, element.selector);
    // Holder object (not a bare let) so TS doesn't narrow the closure-mutated value. The
    // correlated response is captured at ANY status (not just 2xx) so a 5xx — the server
    // crashing on the invalid value — is observable, not filtered away as noise.
    const captured: { hit: CorrelatedHit | null } = { hit: null };
    const onResponse = (response: Response): void => {
      if (captured.hit) return;
      try {
        const request = response.request();
        const method = request.method();
        const stateChanging = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (!stateChanging || !sameOrigin(response.url(), origin)) return;
        if (!correlatesToSubmission(request.postData() ?? '', response.url(), plan.violating, target)) return;
        captured.hit = { status: response.status(), url: response.url(), method, response };
      } catch {
        // response detached — ignore
      }
    };
    // An unhandled client exception the injected value triggers is a client-side effect
    // (crash/freeze). Only counted alongside a server-accepted (2xx) submission below.
    const clientError: { message: string | null } = { message: null };
    const onPageError = (err: Error): void => {
      if (clientError.message === null) clientError.message = err.message || 'unhandled client exception';
    };

    ctx.page.on('response', onResponse);
    ctx.page.on('pageerror', onPageError);
    try {
      await stripAndInject(ctx.page, element.selector, plan.violating);
      await triggerFormSubmission(ctx.page, element.selector);
      await ctx.page.waitForTimeout(OBSERVE_WINDOW_MS);
    } finally {
      ctx.page.off('response', onResponse);
      ctx.page.off('pageerror', onPageError);
    }

    // Require proof the accepted value caused a meaningful effect. Mere acceptance (a silent
    // benign 2xx) is not impact and is discarded as a false positive.
    // Out of reach on this single-submission path: "invalid data stored" / "wrong transaction
    // result" need a re-fetch or baseline differential, so they are conservatively dropped
    // rather than falsely reported.
    const effect = await resolveEffect(captured.hit, clientError.message);
    if (!effect) return [];

    const label = resolveElementLabel(element);
    const endpoint = relativeEndpoint(effect.url);
    const consequence =
      effect.kind === 'server-error'
        ? `${effect.method} ${endpoint} ${effect.detail}`
        : `${effect.method} ${endpoint} accepted it (HTTP ${effect.status}) and the client then crashed: ${effect.detail}`;
    const message =
      `The "${label}" field enforces ${plan.constraint} only in the browser. ` +
      `After that check was removed and ${describePayload(plan.violating)} was submitted, ${consequence}, ` +
      `so the server did not safely re-apply this rule on this request.`;

    return [
      {
        bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
        title: 'Server mishandled a value the browser was supposed to block',
        severity: 'MEDIUM',
        evidence: {
          message,
          selector: element.selector,
          actionExecuted: 'form-constraint-bypass',
          stateHash: ctx.stateHash,
          statusCode: effect.status,
          signals: [effect.kind === 'server-error' ? 'SERVER_ERROR' : 'CLIENT_CRASH'],
          bypass: {
            element: humanizeElement(element),
            payload: plan.violating,
            strippedAttribute: plan.constraint,
            endpoint,
            method: effect.method,
            status: effect.status,
            effect: effect.kind,
            effectDetail: effect.detail,
          },
        },
      },
    ];
  },
};

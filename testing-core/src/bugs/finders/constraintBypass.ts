import type { Page, Response } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { humanizeElement, resolveElementLabel } from '../../../../shared/reproduction.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';

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

// Prose form of the submitted value — empty string reads as an explicit phrase.
function describePayload(value: string): string {
  return value === '' ? 'an empty value' : `"${value}"`;
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
    .$eval(selector, (node) => {
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return null;
      const maxLen = parseInt(node.getAttribute('maxlength') || '', 10);
      return {
        maxLength: Number.isFinite(maxLen) && maxLen > 0 ? maxLen : null,
        pattern: node.getAttribute('pattern'),
        required: node.hasAttribute('required'),
      };
    })
    .catch(() => null);
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
 * Confirms client-only validation: strips a field's client constraint, submits a
 * value the browser would reject, and reports ONLY when the backend accepts it
 * (a 2xx on a state-changing same-origin request that CORRELATES to this
 * submission — see {@link correlatesToSubmission}). A server that rejects the value
 * (4xx / error) is correctly enforcing the rule and yields no finding — so a silent
 * acceptance, the most common form of this bug, is no longer invisible.
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

    const plan = planFromType(element) ?? planFromSnapshot(await readConstraintSnapshot(ctx.page, element.selector));
    if (!plan) return []; // no enforceable client constraint → nothing to bypass

    const origin = safeOrigin(ctx.targetUrl);
    // Resolved BEFORE the constraints are stripped, so the form action and field
    // name are read while the DOM still reflects the untouched control.
    const target = await resolveSubmissionTarget(ctx.page, element.selector);
    // Holder object (not a bare let) so TS doesn't narrow the closure-mutated value.
    const captured: { hit: { status: number; url: string; method: string } | null } = { hit: null };
    const onResponse = (response: Response): void => {
      if (captured.hit) return;
      try {
        const request = response.request();
        const method = request.method();
        const stateChanging = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (!stateChanging || response.status() >= 400 || !sameOrigin(response.url(), origin)) return;
        if (!correlatesToSubmission(request.postData() ?? '', response.url(), plan.violating, target)) return;
        captured.hit = { status: response.status(), url: response.url(), method };
      } catch {
        // response detached — ignore
      }
    };

    ctx.page.on('response', onResponse);
    try {
      await stripAndInject(ctx.page, element.selector, plan.violating);
      await triggerFormSubmission(ctx.page, element.selector);
      await ctx.page.waitForTimeout(OBSERVE_WINDOW_MS);
    } finally {
      ctx.page.off('response', onResponse);
    }

    const accepted = captured.hit;
    if (!accepted) return []; // server rejected/errored or nothing submitted → not confirmed

    const label = resolveElementLabel(element);
    const endpoint = relativeEndpoint(accepted.url);
    const message =
      `The "${label}" field enforces ${plan.constraint} only in the browser. ` +
      `After that check was removed and ${describePayload(plan.violating)} was submitted, ` +
      `${accepted.method} ${endpoint} returned HTTP ${accepted.status} instead of rejecting it, ` +
      `so the server did not re-apply this rule on this request.`;

    return [
      {
        bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
        title: 'Server accepted a value the browser was supposed to block',
        severity: 'MEDIUM',
        evidence: {
          message,
          selector: element.selector,
          actionExecuted: 'form-constraint-bypass',
          stateHash: ctx.stateHash,
          statusCode: accepted.status,
          bypass: {
            element: humanizeElement(element),
            payload: plan.violating,
            strippedAttribute: plan.constraint,
            endpoint,
            method: accepted.method,
            status: accepted.status,
          },
        },
      },
    ];
  },
};

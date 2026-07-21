import type { Page, Response } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { BugFinder, BugContext, BugFinding } from '../types.js';
import { triggerFormSubmission } from '../../domain/services/exploration/formSubmitter.js';
import { humanizeElement } from '../../domain/services/forensics/narration.js';

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

function sameOrigin(url: string, origin: string): boolean {
  return origin !== '' && safeOrigin(url) === origin;
}

// Type-based constraints (email/number/url) come from the element snapshot captured
// at parse time, so they survive an earlier action stripping the live DOM attributes.
function planFromType(element: InteractiveElement): ViolationPlan | null {
  switch ((element.type || '').toLowerCase()) {
    case 'email':
      return { violating: 'not-an-email', constraint: 'type=email' };
    case 'url':
      return { violating: 'not a url', constraint: 'type=url' };
    case 'number':
      return { violating: 'x-not-a-number', constraint: 'type=number' };
    default:
      return null;
  }
}

// Attribute-based fallback: read the LIVE DOM and keep only a value the browser
// itself rejects (checkValidity). Fires only when the constraints are still present
// (an unfuzzed field), so it never guesses a gate that isn't there.
async function planFromAttributes(page: Page, selector: string): Promise<ViolationPlan | null> {
  return page
    .$eval(selector, (node) => {
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return null;
      const el = node;
      const maxLen = parseInt(el.getAttribute('maxlength') || '', 10);
      const candidates: Array<{ v: string; c: string }> = [];
      const pattern = el.getAttribute('pattern');
      if (pattern) candidates.push({ v: '!bypass 123!', c: `pattern=${pattern}` });
      if (Number.isFinite(maxLen) && maxLen > 0) candidates.push({ v: 'A'.repeat(maxLen + 32), c: `maxlength=${maxLen}` });
      if (el.hasAttribute('required')) candidates.push({ v: '', c: 'required' });
      const original = el.value;
      for (const cand of candidates) {
        el.value = cand.v;
        const rejected = typeof el.checkValidity === 'function' ? !el.checkValidity() : false;
        if (rejected) {
          el.value = original;
          return { violating: cand.v, constraint: cand.c };
        }
      }
      el.value = original;
      return null;
    })
    .catch(() => null);
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
 * (a 2xx on a state-changing same-origin request). A server that rejects the value
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
    return !attemptedSelectors.has(el.selector);
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const element = ctx.element;
    if (!element) return [];
    attemptedSelectors.add(element.selector); // one probe per field per run

    const plan = planFromType(element) ?? (await planFromAttributes(ctx.page, element.selector));
    if (!plan) return []; // no enforceable client constraint → nothing to bypass

    const origin = safeOrigin(ctx.targetUrl);
    // Holder object (not a bare let) so TS doesn't narrow the closure-mutated value.
    const captured: { hit: { status: number; url: string } | null } = { hit: null };
    const onResponse = (response: Response): void => {
      if (captured.hit) return;
      try {
        const method = response.request().method();
        const stateChanging = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (stateChanging && response.status() < 400 && sameOrigin(response.url(), origin)) {
          captured.hit = { status: response.status(), url: response.url() };
        }
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

    return [
      {
        bugClass: 'CLIENT_SIDE_CONSTRAINT_BYPASS',
        title: 'Client-only validation bypassed — server accepted invalid input',
        severity: 'MEDIUM',
        evidence: {
          message: `Removed the ${plan.constraint} rule on ${humanizeElement(element)}, submitted a value the browser would normally reject, and the server accepted it (HTTP ${accepted.status} at ${accepted.url}). Validation is enforced only in the browser.`,
          selector: element.selector,
          actionExecuted: 'form-constraint-bypass',
          stateHash: ctx.stateHash,
          statusCode: accepted.status,
        },
      },
    ];
  },
};

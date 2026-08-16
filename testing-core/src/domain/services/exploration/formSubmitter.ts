import type { ElementHandle, Page, Request } from 'playwright';

/**
 * Centralized form-commitment pipeline.
 *
 * Single source of truth for "send the typed data to the backend" used by both
 * the standard ActionExecutor interaction path and the dataFuzzer stress
 * scenario. Keeps the dependency surface tiny (only Playwright types) so it can
 * be reused anywhere without risking circular imports.
 */

export type SubmissionMethod = 'enter' | 'submit-button' | 'form-dispatch' | 'none';

/**
 * How the form committed + the submit control that committed it (when a button did).
 * The label lets the reproduction playbook name the exact control ("Click the "Login"
 * button to submit"), instead of a generic "Submit the form".
 */
export interface SubmissionResult {
  method: SubmissionMethod;
  controlLabel?: string;
  controlKind?: string;
}

/**
 * Unambiguous submit phrases: matched on a word boundary, so 'login' cannot fire
 * on 'blogger'. Safe as a substring-with-boundary because no common non-submit
 * control is labelled with them.
 */
const SUBMIT_PHRASE_TOKENS = [
  'login', 'log in', 'sign in', 'signin', 'submit', 'apply', 'proceed', 'finish', 'continue',
];

/**
 * Ambiguous verbs that routinely appear inside NON-submit labels ('resend',
 * 'Save for later', 'Accept cookies'). Matched only when they are the WHOLE
 * normalized label, so the ladder cannot click the wrong control.
 */
const SUBMIT_EXACT_TOKENS = ['send', 'next', 'save', 'accept', 'confirm'];

/** Selector for controls the ladder is allowed to consider. */
const CANDIDATE_SELECTOR = 'button, [role="button"], input[type="button"]';
const EXPLICIT_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"], [type="submit"]';

/**
 * Lightweight page signature used to detect whether a submission attempt
 * actually changed anything (navigation, DOM mutation, validation render).
 * Defensive by design — never throws, returns '' on evaluation failure so the
 * comparison simply treats the state as "unchanged".
 */
async function captureSignature(page: Page): Promise<string> {
  return page
    .evaluate(() => `${location.href}::${document.querySelectorAll('*').length}`)
    .catch(() => '');
}

/**
 * Outbound-submission detector. The DOM/URL signature alone cannot see a submit
 * that fires a `fetch` and renders a toast — element count and href are both
 * unchanged — so the ladder used to re-commit the same form 2–3×, duplicating
 * state-changing backend writes. Any non-GET request, or a document navigation,
 * proves the data left the browser and stops the escalation.
 */
interface SubmissionProbe {
  fired(): boolean;
  dispose(): void;
}

function watchSubmissions(page: Page): SubmissionProbe {
  let seen = false;
  const onRequest = (request: Request): void => {
    if (seen) return;
    // Subresource GETs (images, scripts, css) are page noise, not a submission.
    if (request.method() !== 'GET' || request.resourceType() === 'document') seen = true;
  };
  page.on('request', onRequest);
  return {
    fired: () => seen,
    dispose: () => page.off('request', onRequest),
  };
}

/**
 * Resolve the submit control that commits the field at `elementSelector`, scoped
 * to the field's OWN grouping: the parent `<form>`, else the nearest ancestor
 * (never `<body>`/`<html>`) that actually contains a control. A formless field
 * commits via its own grouping and never cross-wires to a page-wide button — a
 * search box must not fire the login endpoint.
 *
 * Shared by both the ladder and the race probe so scope resolution and label
 * matching exist exactly once. Returns a handle so the caller decides how to
 * actuate it (one click, or a synchronous burst).
 */
async function findSubmitControl(
  page: Page,
  elementSelector: string,
): Promise<ElementHandle<HTMLElement> | null> {
  const handle = await page
    .evaluateHandle(
      ({ sel, candidateSel, explicitSel, phrases, exacts }) => {
        const node = document.querySelector(sel);
        if (!node) return null;

        let scope: Element | null = node.closest('form');
        if (!scope) {
          let ancestor = node.parentElement;
          while (ancestor && ancestor !== document.body && ancestor.tagName !== 'HTML') {
            if (ancestor.querySelector(`${candidateSel}, ${explicitSel}`)) { scope = ancestor; break; }
            ancestor = ancestor.parentElement;
          }
        }
        if (!scope) return null;

        const explicit = scope.querySelector(explicitSel) as HTMLElement | null;
        if (explicit) return explicit;

        // Collapse whitespace so 'Sign  In\n' normalizes to 'sign in'.
        const labelOf = (el: HTMLElement): string =>
          (el.textContent ?? (el as HTMLInputElement).value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        const onBoundary = (label: string, token: string): boolean =>
          new RegExp(`(?:^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`).test(label);

        const candidates = Array.from(scope.querySelectorAll(candidateSel)) as HTMLElement[];
        // Phrase tokens first (specific), then whole-label matches on ambiguous verbs.
        return (
          candidates.find((el) => phrases.some((tk) => onBoundary(labelOf(el), tk))) ??
          candidates.find((el) => exacts.includes(labelOf(el))) ??
          null
        );
      },
      {
        sel: elementSelector,
        candidateSel: CANDIDATE_SELECTOR,
        explicitSel: EXPLICIT_SUBMIT_SELECTOR,
        phrases: SUBMIT_PHRASE_TOKENS,
        exacts: SUBMIT_EXACT_TOKENS,
      },
    )
    .catch(() => null);

  if (!handle) return null;
  const element = handle.asElement() as ElementHandle<HTMLElement> | null;
  if (!element) {
    await handle.dispose().catch(() => undefined);
    return null;
  }
  return element;
}

/**
 * Progressive form commitment for the input at `elementSelector`, following the
 * mandated priority ladder:
 *
 *  Step 1: native keyboard submit — `page.press(selector, 'Enter')`.
 *  Step 2: if nothing was committed, click the submit control resolved from the
 *          input's own grouping (explicit `type=submit`, else a semantic label).
 *  Step 3: if still nothing, dispatch a synthetic `submit` event to the parent form.
 *
 * A rung is only escalated past when BOTH oracles say nothing happened: the page
 * signature is unchanged AND no outbound submission was observed.
 *
 * @returns the method that committed the form, or 'none'.
 */
export async function triggerFormSubmission(page: Page, elementSelector: string): Promise<SubmissionResult> {
  // Step 0 — Tab to blur the field, firing blur/focusout events that SPA
  // frameworks (React, Vue, Angular) use for per-field validation triggers.
  // Non-fatal: Tab may fail on detached or non-focusable nodes. Watched from
  // AFTER this point so a blur-triggered autosave isn't read as our submission.
  try {
    await page.press(elementSelector, 'Tab', { timeout: 1000 });
    await page.waitForTimeout(150);
  } catch {
    // fall through
  }

  const before = await captureSignature(page);
  const probe = watchSubmissions(page);
  const committed = async (): Promise<boolean> => probe.fired() || (await captureSignature(page)) !== before;

  try {
    // Step 1 — native Enter on the active input.
    try {
      await page.press(elementSelector, 'Enter', { timeout: 1000 });
      await page.waitForTimeout(250);
      if (await committed()) return { method: 'enter' };
    } catch {
      // Element may be detached/non-focusable — fall through to button discovery.
    }

    // Step 2 — click the submit control within the field's own grouping.
    const control = await findSubmitControl(page, elementSelector);
    if (control) {
      // Read the control's label BEFORE the click so the playbook can name it verbatim.
      const controlLabel = await control
        .evaluate((el) => (el.textContent ?? (el as HTMLInputElement).value ?? '').replace(/\s+/g, ' ').trim())
        .catch(() => '');
      try {
        await control.evaluate((el) => el.click());
        await page.waitForTimeout(250);
        if (await committed()) {
          return { method: 'submit-button', controlLabel: controlLabel || undefined, controlKind: 'button' };
        }
      } catch {
        // Control detached between resolution and click — fall through.
      } finally {
        await control.dispose().catch(() => undefined);
      }
    }

    // Step 3 — synthetic submit dispatch on the parent form as a last resort.
    await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        const form = el?.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }, elementSelector)
      .catch(() => undefined);
    await page.waitForTimeout(250);

    return { method: (await committed()) ? 'form-dispatch' : 'none' };
  } finally {
    probe.dispose();
  }
}

/**
 * Race-condition probe: fire the form's submit control N times with zero delay
 * inside a single synchronous browser tick, so all clicks land before any async
 * handler (debounce guard, disable-on-submit, in-flight lock) can react. Surfaces
 * double-submit races — duplicate orders, double auth, idempotency gaps.
 *
 * Non-throwing: returns how many synchronous clicks actually dispatched.
 */
export async function concurrentDoubleSubmit(
  page: Page,
  elementSelector: string,
  times = 2,
): Promise<number> {
  const control = await findSubmitControl(page, elementSelector);
  if (!control) return 0;
  try {
    return await control.evaluate((el, n) => {
      // Zero-wait synchronous burst: no await between clicks.
      let fired = 0;
      for (let i = 0; i < n; i++) {
        el.click();
        fired++;
      }
      return fired;
    }, times);
  } catch {
    return 0;
  } finally {
    await control.dispose().catch(() => undefined);
  }
}

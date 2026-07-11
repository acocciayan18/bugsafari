import type { Page } from 'playwright';

/**
 * Centralized form-commitment pipeline.
 *
 * Single source of truth for "send the typed data to the backend" used by both
 * the standard ActionExecutor interaction path and the dataFuzzer stress
 * scenario. Keeps the dependency surface tiny (only the Playwright `Page` type)
 * so it can be reused anywhere without risking circular imports.
 */

export type SubmissionMethod = 'enter' | 'submit-button' | 'form-dispatch' | 'none';

/**
 * Semantic textual hints for submit-like controls that lack an explicit
 * `type="submit"` (common in SPA login/checkout forms wired via onClick).
 */
const SUBMIT_TEXT_TOKENS = [
  'login', 'log in', 'sign in', 'signin', 'submit', 'apply', 'continue', 'next', 'send',
  // Confirmation / continuation / modal controls that advance a multi-step flow.
  'confirm', 'accept', 'proceed', 'save', 'finish',
];

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
 * Progressive form commitment for the input at `elementSelector`, following the
 * mandated priority ladder:
 *
 *  Step 1: native keyboard submit — `page.press(selector, 'Enter')`.
 *  Step 2: if the DOM/URL context is unchanged, search the input's parent
 *          `<form>` subtree for a submit control — `button[type="submit"]`,
 *          `input[type="submit"]`, or any button whose text matches a semantic
 *          token (Login / Submit / Apply / Sign In, …) — and `.click()` it.
 *  Step 3: if still unchanged, dispatch a synthetic `submit` event straight to
 *          the parent `<form>` container.
 *
 * @returns the method that produced an observable state change, or 'none'.
 */
export async function triggerFormSubmission(page: Page, elementSelector: string): Promise<SubmissionMethod> {
  const before = await captureSignature(page);

  // Step 0 — Tab to blur the field, firing blur/focusout events that SPA
  // frameworks (React, Vue, Angular) use for per-field validation triggers.
  // Non-fatal: Tab may fail on detached or non-focusable nodes.
  try {
    await page.press(elementSelector, 'Tab', { timeout: 1000 });
    await page.waitForTimeout(150);
  } catch {
    // fall through
  }

  // Step 1 — native Enter on the active input.
  try {
    await page.press(elementSelector, 'Enter', { timeout: 1000 });
    await page.waitForTimeout(250);
    if ((await captureSignature(page)) !== before) {
      return 'enter';
    }
  } catch {
    // Element may be detached/non-focusable — fall through to button discovery.
  }

  // Step 2 — locate and click a submit control inside the parent form subtree.
  const clicked = await page
    .evaluate(({ sel, tokens }) => {
      const node = document.querySelector(sel);
      const form: ParentNode = node?.closest('form') ?? document;
      const explicit = form.querySelector(
        'button[type="submit"], input[type="submit"], [type="submit"]',
      ) as HTMLElement | null;
      const candidates = Array.from(
        form.querySelectorAll('button, [role="button"], input[type="button"]'),
      ) as HTMLElement[];
      const semantic = candidates.find((el) => {
        const label = (el.textContent ?? (el as HTMLInputElement).value ?? '').toLowerCase();
        return tokens.some((tk) => label.includes(tk));
      });
      const pick = explicit ?? semantic;
      if (pick) {
        pick.click();
        return true;
      }
      return false;
    }, { sel: elementSelector, tokens: SUBMIT_TEXT_TOKENS })
    .catch(() => false);

  if (clicked) {
    await page.waitForTimeout(250);
    if ((await captureSignature(page)) !== before) {
      return 'submit-button';
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

  return (await captureSignature(page)) !== before ? 'form-dispatch' : 'none';
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
  return page
    .evaluate(
      ({ sel, tokens, n }) => {
        const node = document.querySelector(sel);
        const form: ParentNode = node?.closest('form') ?? document;
        const explicit = form.querySelector(
          'button[type="submit"], input[type="submit"], [type="submit"]',
        ) as HTMLElement | null;
        const candidates = Array.from(
          form.querySelectorAll('button, [role="button"], input[type="button"]'),
        ) as HTMLElement[];
        const semantic = candidates.find((el) => {
          const label = (el.textContent ?? (el as HTMLInputElement).value ?? '').toLowerCase();
          return tokens.some((tk) => label.includes(tk));
        });
        const pick = explicit ?? semantic;
        if (!pick) return 0;
        // Zero-wait synchronous burst: no await between clicks.
        let fired = 0;
        for (let i = 0; i < n; i++) {
          pick.click();
          fired++;
        }
        return fired;
      },
      { sel: elementSelector, tokens: SUBMIT_TEXT_TOKENS, n: times },
    )
    .catch(() => 0);
}

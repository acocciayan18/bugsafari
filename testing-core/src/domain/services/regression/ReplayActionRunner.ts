import type { Page } from 'playwright';
import type { ActionStepTrace } from '../../../infrastructure/database/models/SessionModel.js';
import { expandReplayMacro } from './ReplayMacroExpander.js';

// Bounded per-action wait so a vanished/renamed selector can't stall the replay.
const ACTION_TIMEOUT_MS = 5000;
const NAV_SETTLE_MS = 800;

export type ReplayStepStatus = 'ok' | 'skipped' | 'error';

export interface ReplayOutcome {
  stepNumber: number;
  actionType: string;
  selector: string;
  status: ReplayStepStatus;
  detail?: string;
}

/**
 * Replays ONE recorded action deterministically against a live page. This is the
 * whole of the "execution engine" during verification — there is no scorer, no
 * navigator, no autonomous target selection: exactly the recorded selector +
 * payload + action type, in the recorded order. A selector that no longer resolves
 * is treated as `skipped` (a fix legitimately removes elements) rather than fatal,
 * so the replay always reaches the validation stage.
 */
export class ReplayActionRunner {
  constructor(private readonly page: Page, private readonly targetUrl: string) {}

  public async replay(step: ActionStepTrace): Promise<ReplayOutcome> {
    const base = { stepNumber: step.stepNumber, actionType: step.actionType, selector: step.selector };
    try {
      switch (step.actionType) {
        case 'input':
          await this.performInput(step.selector, step.payloadText ?? '');
          return { ...base, status: 'ok' };
        case 'bypass':
          await this.performBypass(step);
          return { ...base, status: 'ok' };
        case 'click':
          await this.performClick(step.selector);
          return { ...base, status: 'ok' };
        case 'submit':
          // The recorded selector is the input's; submit its enclosing form to re-send.
          await this.submitEnclosingForm(step.selector);
          return { ...base, status: 'ok' };
        case 'navigation':
          // A navigation step records the DESTINATION URL as its selector (or in url),
          // not a clickable element — replaying it as a click resolves 0 elements and
          // skips, which then strands every following step on the wrong page. Navigate.
          return { ...base, status: await this.performNavigation(step) };
        case 'macro': {
          if (!step.macro) return { ...base, status: 'skipped', detail: 'macro step missing descriptor' };
          const outcome = await expandReplayMacro(this.page, step.macro, this.targetUrl);
          return { ...base, status: outcome.expanded > 0 ? 'ok' : 'skipped', detail: outcome.detail };
        }
        default:
          return { ...base, status: 'skipped', detail: `unknown actionType "${step.actionType}"` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Missing/detached targets are expected when a fix removes the element — not a replay failure.
      if (this.isBenignInteractionError(message)) {
        return { ...base, status: 'skipped', detail: message };
      }
      return { ...base, status: 'error', detail: message };
    }
  }

  /** Strip client-side constraints on the element, then inject the payload via DOM events. */
  private async performInput(selector: string, value: string): Promise<void> {
    await this.stripConstraints(selector);
    await this.injectPayload(selector, value);
  }

  /**
   * Constraint-bypass submit: strip the client guard on the field + its form, inject the
   * recorded (invalid) value, then submit the ENCLOSING FORM — clicking the field alone
   * never posts, so the server-acceptance oracle would never see the request.
   */
  private async performBypass(step: ActionStepTrace): Promise<void> {
    // Inject the (invalid) value first — it lands even on a type=email input; validation
    // only fires on submit. Fill the form's OTHER empty fields so a client "all fields
    // required" guard doesn't block the POST the acceptance oracle needs.
    if (step.payloadText) await this.injectPayload(step.selector, step.payloadText);
    await this.fillOtherFormFields(step.selector);
    // Strip the client guards LAST — after the app's own input handlers have re-rendered
    // (a floating-label/framework field can otherwise re-apply type=email), so the native
    // format check is truly gone at submit time.
    await this.stripConstraints(step.selector);
    await this.submitEnclosingForm(step.selector);
  }

  /** Give every OTHER empty field in the form a plausible value so the submit isn't blocked. */
  private async fillOtherFormFields(selector: string): Promise<void> {
    await this.page
      .evaluate((sel) => {
        const anchor = document.querySelector(sel);
        const form = anchor?.closest('form');
        if (!form) return;
        const SKIP = new Set(['hidden', 'submit', 'button', 'checkbox', 'radio', 'file']);
        form.querySelectorAll('input, textarea').forEach((node) => {
          const input = node as HTMLInputElement;
          if (input === anchor || SKIP.has(input.type) || input.value) return;
          input.value = input.type === 'email' ? 'test@test.com' : input.type === 'password' ? 'Password1!' : 'test';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }, selector)
      .catch(() => undefined);
  }

  /**
   * Commit the form containing `selector`. Prefer CLICKING the form's submit control —
   * apps commonly wire the request to the button's click handler, so form.requestSubmit()
   * only fires the (unhandled) submit event and triggers a native GET instead. Fall back
   * to requestSubmit, then to clicking the field itself.
   */
  private async submitEnclosingForm(selector: string): Promise<void> {
    const settle = () => this.page.waitForLoadState('domcontentloaded', { timeout: NAV_SETTLE_MS }).catch(() => undefined);
    // Explicit submit controls only — an untyped <button> often is an unrelated toggle
    // (password reveal, etc.) that would be clicked first and never submit.
    const submit = this.page
      .locator(selector)
      .first()
      .locator('xpath=ancestor::form[1]')
      .locator('button[type="submit"], input[type="submit"]')
      .first();
    if (await submit.count().catch(() => 0)) {
      await submit.click({ force: true, timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
      await settle();
      return;
    }
    const submitted = await this.page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        const form = el ? (el.closest('form') as HTMLFormElement | null) : null;
        if (!form) return false;
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
        return true;
      }, selector)
      .catch(() => false);
    if (!submitted) {
      await this.performClick(selector);
      return;
    }
    await settle();
  }

  /**
   * Replay a recorded navigation by loading its destination URL. The URL is the step's
   * selector (navigation steps store the destination there) or its `url`. If neither is a
   * URL the navigation was triggered by clicking a control, so fall back to that click.
   * A no-op when already on the destination — avoids a redundant reload that would reset
   * restored state.
   */
  private async performNavigation(step: ActionStepTrace): Promise<ReplayStepStatus> {
    const url = this.resolveNavUrl(step);
    if (url) {
      if (this.samePage(url)) return 'ok';
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT_MS });
      await this.page.waitForLoadState('domcontentloaded', { timeout: NAV_SETTLE_MS }).catch(() => undefined);
      return 'ok';
    }
    if (step.selector && step.selector !== 'N/A') {
      await this.performClick(step.selector);
      return 'ok';
    }
    return 'skipped';
  }

  /** The destination URL of a navigation step: the URL-valued selector, else the url field. */
  private resolveNavUrl(step: ActionStepTrace): string | undefined {
    if (/^https?:\/\//i.test(step.selector)) return step.selector;
    if (step.url && /^https?:\/\//i.test(step.url)) return step.url;
    return undefined;
  }

  /** True when the live page is already on `url`'s origin+path (ignore query/hash churn). */
  private samePage(url: string): boolean {
    try {
      const a = new URL(url);
      const b = new URL(this.page.url());
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch {
      return false;
    }
  }

  /** Force-click the recorded control and let any triggered navigation settle briefly. */
  private async performClick(selector: string): Promise<void> {
    await this.page.locator(selector).first().click({ force: true, timeout: ACTION_TIMEOUT_MS });
    await this.page.waitForLoadState('domcontentloaded', { timeout: NAV_SETTLE_MS }).catch(() => undefined);
  }

  /** Remove required/disabled/readonly/maxlength/pattern + native validation so payloads land. */
  private async stripConstraints(selector: string): Promise<void> {
    // NOTE: no NAMED nested function inside evaluate — esbuild/tsx instruments those with a
    // __name() helper that is undefined in the page context, which silently voids the whole
    // callback. Keep the body a flat inline loop.
    await this.page
      .evaluate((sel) => {
        const anchor = document.querySelector(sel);
        if (!anchor) return;
        const form = anchor.closest('form');
        const targets: Element[] = form ? Array.from(form.querySelectorAll('input, textarea, select')) : [];
        if (!targets.includes(anchor)) targets.push(anchor);
        const FORMAT = ['email', 'url', 'tel', 'number', 'date', 'time'];
        for (const el of targets) {
          el.removeAttribute('required');
          el.removeAttribute('disabled');
          el.removeAttribute('readonly');
          el.removeAttribute('maxlength');
          el.removeAttribute('pattern');
          el.removeAttribute('min');
          el.removeAttribute('max');
          el.removeAttribute('step');
          const input = el as HTMLInputElement;
          input.disabled = false;
          input.readOnly = false;
          input.required = false;
          // Downgrade a format-validated type so the native check can't reject the payload.
          if (input.type && FORMAT.includes(input.type)) {
            try { input.type = 'text'; } catch { /* some controls forbid type reassignment */ }
          }
        }
        if (form) {
          // Decisive bypass: disable ALL native constraint validation on submit.
          (form as HTMLFormElement).noValidate = true;
          form.setAttribute('novalidate', '');
        }
      }, selector)
      .catch(() => undefined);
  }

  /** Set the value + dispatch input/change so framework listeners register the payload. */
  private async injectPayload(selector: string, value: string): Promise<void> {
    await this.page.evaluate(
      ({ sel, val }: { sel: string; val: string }) => {
        const node = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!node) throw new Error(`Element not found for selector: ${sel}`);
        node.focus();
        node.value = val;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { sel: selector, val: value },
    );
  }

  private isBenignInteractionError(message: string): boolean {
    return (
      message.includes('Timeout') ||
      message.includes('waiting for') ||
      message.includes('not found') ||
      message.includes('detached') ||
      message.includes('not attached') ||
      message.includes('not visible') ||
      message.includes('is not clickable') ||
      message.includes('obscured') ||
      message.includes('resolved to 0 elements')
    );
  }
}

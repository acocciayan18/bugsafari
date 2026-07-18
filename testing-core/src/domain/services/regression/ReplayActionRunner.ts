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
          await this.performBypass(step.selector);
          return { ...base, status: 'ok' };
        case 'click':
        case 'navigation':
          await this.performClick(step.selector);
          return { ...base, status: 'ok' };
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

  /** Constraint-bypass submit: strip the enclosing form's constraints, then commit the control. */
  private async performBypass(selector: string): Promise<void> {
    await this.stripConstraints(selector);
    await this.performClick(selector);
  }

  /** Force-click the recorded control and let any triggered navigation settle briefly. */
  private async performClick(selector: string): Promise<void> {
    await this.page.locator(selector).first().click({ force: true, timeout: ACTION_TIMEOUT_MS });
    await this.page.waitForLoadState('domcontentloaded', { timeout: NAV_SETTLE_MS }).catch(() => undefined);
  }

  /** Remove required/disabled/readonly/maxlength on the element (and its form) so payloads land. */
  private async stripConstraints(selector: string): Promise<void> {
    await this.page
      .evaluate((sel) => {
        const strip = (el: Element | null): void => {
          if (!el) return;
          el.removeAttribute('required');
          el.removeAttribute('disabled');
          el.removeAttribute('readonly');
          el.removeAttribute('maxlength');
          el.removeAttribute('pattern');
          const input = el as HTMLInputElement;
          input.disabled = false;
          input.readOnly = false;
          input.required = false;
        };
        const anchor = document.querySelector(sel);
        strip(anchor);
        const form = anchor?.closest('form');
        if (form) form.querySelectorAll('input, textarea, select').forEach(strip);
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

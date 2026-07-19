import type { Page } from 'playwright';
import type { TargetAuthConfig, TargetAuthResult } from '../../../../shared/types.js';

const NAV_TIMEOUT_MS = 20000;
const FIELD_TIMEOUT_MS = 8000;
const SUCCESS_TIMEOUT_MS = 12000;

const USERNAME_HINT_RE = /user|email|login|account|identifier/i;
const SUBMIT_TEXT_RE = /log\s?in|sign\s?in|continue|submit/i;
const AUTH_ERROR_RE = /invalid|incorrect|failed|try again|wrong|unauthori[sz]ed/i;

const ERROR_AFFORDANCE_SELECTORS = ['[role="alert"]', '.error', '.invalid-feedback', '[aria-invalid="true"]'];

interface ResolvedSelectors {
  username: string;
  password: string;
  submit: string;
}

/**
 * Logs the engine into the application under test so exploration can reach
 * authenticated surface.
 *
 * Stateless by design: credentials are passed per call and never retained here.
 * Emits no telemetry — every reason string below is a fixed literal, so no
 * credential material can reach a log or socket through this class.
 */
export class TargetAuthenticator {
  public async authenticate(
    page: Page,
    config: TargetAuthConfig,
    targetUrl: string,
  ): Promise<TargetAuthResult> {
    try {
      await page.goto(config.loginUrl ?? targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
    } catch {
      return { status: 'failed', reason: 'the login page could not be loaded' };
    }

    const resolved = await this.resolveSelectors(page, config);
    if (!resolved) {
      return {
        status: 'failed',
        reason: 'no login form was found — supply usernameSelector/passwordSelector explicitly',
      };
    }

    try {
      await page.fill(resolved.username, config.username, { timeout: FIELD_TIMEOUT_MS });
      await page.fill(resolved.password, config.password, { timeout: FIELD_TIMEOUT_MS });
    } catch {
      return { status: 'failed', reason: 'the resolved login fields could not be filled' };
    }

    await this.submit(page, resolved);

    // Clear the password field immediately: any screenshot taken after a FAILED
    // login would otherwise capture the filled control.
    await page.fill(resolved.password, '', { timeout: 2000 }).catch(() => undefined);

    return this.verify(page, config, resolved);
  }

  /** Explicit selectors win; otherwise detect the form around the password field. */
  private async resolveSelectors(
    page: Page,
    config: TargetAuthConfig,
  ): Promise<ResolvedSelectors | null> {
    if (config.usernameSelector && config.passwordSelector) {
      return {
        username: config.usernameSelector,
        password: config.passwordSelector,
        submit: config.submitSelector ?? '',
      };
    }

    const detected = await page
      .evaluate(
        ([usernameHint, submitText]: [string, string]) => {
          const cssPath = (el: Element): string => {
            if (el.id) return `#${CSS.escape(el.id)}`;
            const parts: string[] = [];
            let node: Element | null = el;
            while (node && node.tagName !== 'HTML' && parts.length < 6) {
              const parent: Element | null = node.parentElement;
              if (!parent) break;
              const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
              const index = siblings.indexOf(node) + 1;
              parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
              node = parent;
            }
            return parts.join(' > ');
          };

          const visible = (el: Element): boolean => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          const password = Array.from(
            document.querySelectorAll('input[type="password"]'),
          ).find(visible);
          if (!password) return null;

          // Scope to the enclosing form — this is what makes username detection reliable.
          const scope = password.closest('form') ?? document.body;
          const userRe = new RegExp(usernameHint, 'i');
          const username = Array.from(scope.querySelectorAll('input')).find((input) => {
            if (input === password || !visible(input)) return false;
            const type = (input.getAttribute('type') ?? 'text').toLowerCase();
            if (!['text', 'email', 'tel', ''].includes(type)) return false;
            const hints = `${input.name} ${input.id} ${input.getAttribute('autocomplete') ?? ''} ${
              input.getAttribute('placeholder') ?? ''
            }`;
            return userRe.test(hints) || type === 'email';
          });
          if (!username) return null;

          const submitRe = new RegExp(submitText, 'i');
          const submit =
            scope.querySelector('button[type="submit"], input[type="submit"]') ??
            Array.from(scope.querySelectorAll('button')).find((b) => submitRe.test(b.textContent ?? ''));

          return {
            username: cssPath(username),
            password: cssPath(password),
            submit: submit ? cssPath(submit) : '',
          };
        },
        [USERNAME_HINT_RE.source, SUBMIT_TEXT_RE.source] as [string, string],
      )
      .catch(() => null);

    if (!detected) return null;
    return {
      username: config.usernameSelector ?? detected.username,
      password: config.passwordSelector ?? detected.password,
      submit: config.submitSelector ?? detected.submit,
    };
  }

  /** Click submit when one was resolved, else press Enter in the password field. */
  private async submit(page: Page, resolved: ResolvedSelectors): Promise<void> {
    try {
      if (resolved.submit) {
        await page.click(resolved.submit, { timeout: FIELD_TIMEOUT_MS });
      } else {
        await page.press(resolved.password, 'Enter', { timeout: FIELD_TIMEOUT_MS });
      }
    } catch {
      // Submission may itself navigate away mid-click — verification is the judge.
    }
  }

  /**
   * Success oracle. An explicit indicator wins; otherwise the password field going
   * away is the primary signal — it survives SPA logins that never change the URL,
   * which defeat URL comparison. A visible auth error overrides both, because some
   * apps clear the form on failure and would look identical to success.
   */
  private async verify(
    page: Page,
    config: TargetAuthConfig,
    resolved: ResolvedSelectors,
  ): Promise<TargetAuthResult> {
    if (config.successIndicator) {
      const seen = await page
        .waitForSelector(config.successIndicator, { timeout: SUCCESS_TIMEOUT_MS, state: 'visible' })
        .then(() => true)
        .catch(() => false);
      return seen
        ? { status: 'authenticated', reason: 'success indicator appeared', resolution: resolved }
        : { status: 'failed', reason: 'the configured success indicator never appeared' };
    }

    const passwordGone = await page
      .waitForSelector(resolved.password, { timeout: SUCCESS_TIMEOUT_MS, state: 'hidden' })
      .then(() => true)
      .catch(() => false);

    if (await this.hasAuthError(page)) {
      return { status: 'failed', reason: 'the login form reported invalid credentials' };
    }
    if (!passwordGone) {
      return { status: 'failed', reason: 'the password field is still present after submitting' };
    }
    return { status: 'authenticated', reason: 'login form cleared', resolution: resolved };
  }

  private async hasAuthError(page: Page): Promise<boolean> {
    return page
      .evaluate(
        ([selectors, errorPattern]: [string[], string]) => {
          const re = new RegExp(errorPattern, 'i');
          return selectors.some((selector) =>
            Array.from(document.querySelectorAll(selector)).some((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && re.test(el.textContent ?? '');
            }),
          );
        },
        [[...ERROR_AFFORDANCE_SELECTORS], AUTH_ERROR_RE.source] as [string[], string],
      )
      .catch(() => false);
  }
}

import type { Page } from 'playwright';
import type {
  TargetAuthConfig,
  TargetAuthResult,
  TargetCredentialsAuth,
  TargetStorageStateAuth,
} from '../../../../shared/types.js';
import { resolveControlName } from '../../../../shared/reproduction.js';
import type { AuthNarrator } from '../../domain/services/auth/AuthNarrator.js';
import { LoginFormLocator, type ResolvedSelectors } from './LoginFormLocator.js';
import { maskField } from './credentialMask.js';

const NAV_TIMEOUT_MS = 20000;
const FIELD_TIMEOUT_MS = 8000;
const SUCCESS_TIMEOUT_MS = 12000;

const AUTH_ERROR_RE = /invalid|incorrect|failed|try again|wrong|unauthori[sz]ed/i;

const ERROR_AFFORDANCE_SELECTORS = ['[role="alert"]', '.error', '.invalid-feedback', '[aria-invalid="true"]'];

/**
 * Logs the engine into the application under test so exploration can reach
 * authenticated surface.
 *
 * Stateless by design: credentials are passed per call and never retained here.
 * Every phase is narrated through the injected {@link AuthNarrator}, and every
 * `reason` string below is a fixed literal, so the login is fully observable
 * without any credential material reaching a log, a socket, or the playbook.
 */
export class TargetAuthenticator {
  /** Route to the form-login driver or the seeded-session probe. */
  public async authenticate(
    page: Page,
    config: TargetAuthConfig,
    targetUrl: string,
    narrator?: AuthNarrator,
  ): Promise<TargetAuthResult> {
    narrator?.started(config.mode);
    const result =
      config.mode === 'storageState'
        ? await this.verifySeededSession(page, config, targetUrl)
        : await this.loginWithCredentials(page, config, targetUrl, narrator);

    if (result.status === 'authenticated') narrator?.succeeded(page.url());
    else narrator?.failed(result.reason);
    return result;
  }

  /**
   * storageState mode: the context was already seeded with the operator's session,
   * so there is nothing to submit — only to confirm the session survived. A stale
   * state must fail loudly, otherwise the engine explores a login page and reports
   * a clean run.
   */
  private async verifySeededSession(
    page: Page,
    config: TargetStorageStateAuth,
    targetUrl: string,
  ): Promise<TargetAuthResult> {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch {
      return { status: 'failed', reason: 'the target could not be loaded with the supplied session state' };
    }

    if (config.successIndicator) {
      const seen = await page
        .waitForSelector(config.successIndicator, { timeout: SUCCESS_TIMEOUT_MS, state: 'visible' })
        .then(() => true)
        .catch(() => false);
      return seen
        ? { status: 'authenticated', reason: 'session state accepted — success indicator present' }
        : { status: 'failed', reason: 'the configured success indicator never appeared; the session state is likely expired' };
    }

    // Default oracle: a login wall means the seeded session was rejected.
    return (await this.hasVisiblePasswordField(page))
      ? { status: 'failed', reason: 'the target still presents a login form; the session state is likely expired' }
      : { status: 'authenticated', reason: 'session state accepted — no login wall on the target' };
  }

  private async loginWithCredentials(
    page: Page,
    config: TargetCredentialsAuth,
    targetUrl: string,
    narrator?: AuthNarrator,
  ): Promise<TargetAuthResult> {
    // loginUrl is a hint, not a requirement: it only decides where the search for
    // the form starts. The locator takes over from there.
    const entryUrl = config.loginUrl ?? targetUrl;
    narrator?.navigating(entryUrl);
    try {
      await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch {
      return { status: 'failed', reason: 'the entry page could not be loaded' };
    }

    // Fresh per login: the locator accumulates visited origins/tried controls.
    const location = await new LoginFormLocator().locate(page, config, targetUrl, narrator);
    if (!location) {
      return {
        status: 'failed',
        reason:
          'no login form was found on the target, behind any Login/Sign In control, or at a conventional auth route — supply loginUrl or usernameSelector/passwordSelector, or use session-state mode for SSO/MFA logins',
      };
    }

    const resolved = location.selectors;
    // Mask the username before a single character is typed: the password input
    // hides itself, the username renders in plaintext into every live frame.
    await maskField(page, resolved.username);

    try {
      await page.fill(resolved.username, config.username, { timeout: FIELD_TIMEOUT_MS });
      await page.fill(resolved.password, config.password, { timeout: FIELD_TIMEOUT_MS });
    } catch {
      return { status: 'failed', reason: 'the resolved login fields could not be filled' };
    }
    narrator?.credentialsEntered(page.url());

    // Name and URL are read before the click: submitting usually navigates, and
    // the step should read as the form we acted on, not wherever it landed.
    const submitName = await this.submitName(page, resolved);
    const formUrl = page.url();
    await this.submit(page, resolved);
    narrator?.submitted(submitName, formUrl);

    // Clear the password field immediately: any screenshot taken after a FAILED
    // login would otherwise capture the filled control.
    await page.fill(resolved.password, '', { timeout: 2000 }).catch(() => undefined);

    narrator?.verifying();
    const verdict = await this.verify(page, config, resolved);
    return verdict.status === 'authenticated'
      ? { ...verdict, originsVisited: location.originsVisited }
      : verdict;
  }

  /** Name of the submit control for narration, or null when Enter will be used. */
  private async submitName(page: Page, resolved: ResolvedSelectors): Promise<string | null> {
    if (!resolved.submit) return null;
    const label = await page.textContent(resolved.submit, { timeout: 2000 }).catch(() => null);
    return resolveControlName({ label: label ?? undefined, selector: resolved.submit });
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
    config: TargetCredentialsAuth,
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

  /** Login-wall probe: a visible password input anywhere on the current page. */
  private async hasVisiblePasswordField(page: Page): Promise<boolean> {
    return page
      .evaluate(() =>
        Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }),
      )
      .catch(() => false);
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

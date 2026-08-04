import type { Page } from 'playwright';
import type {
  TargetAuthConfig,
  TargetAuthResult,
  TargetCredentialsAuth,
  TargetStorageStateAuth,
} from '../../../../shared/types.js';
import { resolveControlName } from '../../../../shared/reproduction.js';
import type { AuthNarrator } from '../../domain/services/auth/AuthNarrator.js';
import { normalizeUrl } from '../../domain/services/auth/loginDiscovery.js';
import { LoginFormLocator, type ResolvedSelectors } from './LoginFormLocator.js';
import { maskField } from './credentialMask.js';

const NAV_TIMEOUT_MS = 20000;
const FIELD_TIMEOUT_MS = 8000;
const SUCCESS_TIMEOUT_MS = 12000;
// After submit fires, let one navigation/URL swap/network-idle signal land, then
// this brief settle so an SPA finishes its state transition before the oracle reads.
const POST_SUBMIT_SETTLE_MS = 600;

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

    const entered = await this.enterCredentials(page, resolved, config);
    if (!entered) {
      return { status: 'failed', reason: 'the resolved login fields could not be filled' };
    }
    narrator?.credentialsEntered(page.url());

    // Name and URL are read before the click: submitting usually navigates, and
    // the step should read as the form we acted on, not wherever it landed.
    const submitName = await this.submitName(page, resolved);
    const formUrl = page.url();
    await this.submit(page, resolved);
    narrator?.submitted(submitName, formUrl);

    // Give the app one navigation/URL-change/network-idle signal before reading it.
    await this.settleAfterSubmit(page);

    // Clear the password field immediately: any screenshot taken after a FAILED
    // login would otherwise capture the filled control.
    await page.fill(resolved.password, '', { timeout: 2000 }).catch(() => undefined);

    narrator?.verifying();
    const verdict = await this.verify(page, config, resolved, formUrl);
    return verdict.status === 'authenticated'
      ? { ...verdict, originsVisited: location.originsVisited }
      : verdict;
  }

  /**
   * Type both fields like a user: fill sets the value through the native setter
   * (so React/Vue controlled inputs register it), then input/change/blur are
   * dispatched so validation and enable-on-valid logic runs before we submit.
   */
  private async enterCredentials(
    page: Page,
    resolved: ResolvedSelectors,
    config: TargetCredentialsAuth,
  ): Promise<boolean> {
    try {
      await page.fill(resolved.username, config.username, { timeout: FIELD_TIMEOUT_MS });
      await this.notifyField(page, resolved.username);
      await page.fill(resolved.password, config.password, { timeout: FIELD_TIMEOUT_MS });
      await this.notifyField(page, resolved.password);
      return true;
    } catch {
      return false;
    }
  }

  /** Fire the events a real keystroke+blur would, so SPA form state catches up. */
  private async notifyField(page: Page, selector: string): Promise<void> {
    for (const type of ['input', 'change', 'blur'] as const) {
      await page.dispatchEvent(selector, type, undefined, { timeout: 2000 }).catch(() => undefined);
    }
  }

  /**
   * Wait for the app to react to submit: whichever of a full navigation, an SPA
   * URL swap, or network-idle lands first, then a brief settle. Bounded so a login
   * that neither navigates nor calls out still proceeds to the oracle promptly.
   */
  private async settleAfterSubmit(page: Page): Promise<void> {
    const startUrl = page.url();
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: SUCCESS_TIMEOUT_MS }).catch(() => undefined),
      page.waitForFunction((from) => window.location.href !== from, startUrl, { timeout: SUCCESS_TIMEOUT_MS }).catch(() => undefined),
      page.waitForLoadState('networkidle', { timeout: SUCCESS_TIMEOUT_MS }).catch(() => undefined),
    ]);
    await page.waitForTimeout(POST_SUBMIT_SETTLE_MS);
  }

  /** Name of the submit control for narration, or null when Enter will be used. */
  private async submitName(page: Page, resolved: ResolvedSelectors): Promise<string | null> {
    if (!resolved.submit) return null;
    const label = await page.textContent(resolved.submit, { timeout: 2000 }).catch(() => null);
    return resolveControlName({ label: label ?? undefined, selector: resolved.submit });
  }

  /**
   * Prefer clicking the real submit control — that is what a user does and what
   * SPA click handlers listen for. Only with no clickable submit do we fall back
   * to Enter, and finally to a programmatic requestSubmit on the owning form.
   */
  private async submit(page: Page, resolved: ResolvedSelectors): Promise<void> {
    try {
      if (resolved.submit) {
        await page.click(resolved.submit, { timeout: FIELD_TIMEOUT_MS });
        return;
      }
      await page.press(resolved.password, 'Enter', { timeout: FIELD_TIMEOUT_MS });
    } catch {
      // Enter may be swallowed by a form with no default submit — ask the form itself.
      await this.requestSubmit(page, resolved.password);
    }
  }

  /** Last resort: submit the password field's owning form the way the browser would. */
  private async requestSubmit(page: Page, passwordSelector: string): Promise<void> {
    await page
      .evaluate((selector) => {
        const field = document.querySelector(selector);
        const form = field?.closest('form');
        if (form instanceof HTMLFormElement) form.requestSubmit();
      }, passwordSelector)
      .catch(() => undefined);
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
    formUrl: string,
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

    // A visible auth error is decisive even when the form otherwise cleared.
    if (await this.hasAuthError(page)) {
      return { status: 'failed', reason: 'the login form reported invalid credentials' };
    }
    if (passwordGone) {
      return { status: 'authenticated', reason: 'login form cleared', resolution: resolved };
    }
    // SPA path: the form may stay mounted while the app routes to an authenticated
    // view. A move off the login URL with no error is success the field probe misses.
    if (normalizeUrl(page.url()) !== normalizeUrl(formUrl)) {
      return { status: 'authenticated', reason: 'the app navigated off the login page', resolution: resolved };
    }
    return { status: 'failed', reason: 'the password field is still present after submitting' };
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

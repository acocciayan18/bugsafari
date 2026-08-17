import type { Page } from 'playwright';
import type {
  TargetAuthConfig,
  TargetAuthResult,
  TargetCredentialsAuth,
} from '../../../../shared/types.js';
import { resolveControlName } from '../../../../shared/reproduction.js';
import { isRetryableAuthFailure } from '../../../../shared/types.js';
import type { AuthNarrator } from '../../domain/services/auth/AuthNarrator.js';
import { classifyCredentialVerdict, type CredentialVerifySignals } from '../../domain/services/auth/authVerdict.js';
import { normalizeUrl } from '../../domain/services/auth/loginDiscovery.js';
import { LoginFormLocator, type ResolvedSelectors } from './LoginFormLocator.js';
import { maskField } from './credentialMask.js';

const NAV_TIMEOUT_MS = 20000;
const FIELD_TIMEOUT_MS = 8000;
const SUCCESS_TIMEOUT_MS = 12000;
// After submit fires, let one navigation/URL swap/network-idle signal land, then
// this brief settle so an SPA finishes its state transition before the oracle reads.
const POST_SUBMIT_SETTLE_MS = 600;

// A transient/load failure re-runs the whole attempt once; a decisive rejection
// (invalid/MFA/CAPTCHA/lock) breaks immediately and never re-submits.
const MAX_ATTEMPTS = 2;

const AUTH_ERROR_RE = /invalid|incorrect|failed|try again|wrong|unauthori[sz]ed/i;

const ERROR_AFFORDANCE_SELECTORS = ['[role="alert"]', '.error', '.invalid-feedback', '[aria-invalid="true"]'];

// A one-time-code input is the strong MFA signal; the text match is scoped to
// prompts (alerts/labels/headings) so ordinary "two-factor" marketing copy elsewhere
// on the page does not trip it.
const MFA_INPUT_SELECTORS = ['input[autocomplete="one-time-code"]', 'input[name*="otp" i]', 'input[name*="totp" i]', 'input[id*="otp" i]', 'input[name*="mfa" i]'];
const MFA_TEXT_SELECTORS = ['[role="alert"]', 'label', 'legend', 'h1', 'h2', 'h3'];
const MFA_TEXT_RE = /\b(one[-\s]?time (code|password)|verification code|security code|authentication code|2fa|two[-\s]?factor|authenticator app|passcode|mfa|otp)\b/i;

const CAPTCHA_SELECTORS = ['iframe[src*="recaptcha" i]', 'iframe[src*="hcaptcha" i]', 'iframe[title*="captcha" i]', '.g-recaptcha', '.h-captcha', '[class*="captcha" i]', '[id*="captcha" i]'];

const LOCKOUT_TEXT_SELECTORS = [...ERROR_AFFORDANCE_SELECTORS, 'h1', 'h2', 'h3', 'p'];
const LOCKOUT_TEXT_RE = /\b(locked|too many (attempts|tries|sign[-\s]?ins?)|temporarily (disabled|blocked|locked)|account (disabled|suspended|locked)|try again later)\b/i;

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
  /**
   * Drive the form login, retrying once on a genuinely transient failure (a
   * page-load error, or no decisive signal yet). A decisive rejection breaks the
   * loop immediately, so credentials are never re-submitted into a form that
   * already rejected them.
   */
  public async authenticate(
    page: Page,
    config: TargetAuthConfig,
    targetUrl: string,
    narrator?: AuthNarrator,
  ): Promise<TargetAuthResult> {
    narrator?.started();
    let result!: TargetAuthResult;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isFinalAttempt = attempt === MAX_ATTEMPTS;
      result = await this.loginWithCredentials(page, config, targetUrl, narrator, isFinalAttempt);

      if (result.status === 'authenticated' || !isRetryableAuthFailure(result.category)) break;
      if (!isFinalAttempt) narrator?.retrying(result.reason);
    }

    if (result.status === 'authenticated') narrator?.succeeded(page.url());
    else narrator?.failed(result.reason);
    return result;
  }

  private async loginWithCredentials(
    page: Page,
    config: TargetCredentialsAuth,
    targetUrl: string,
    narrator: AuthNarrator | undefined,
    isFinalAttempt: boolean,
  ): Promise<TargetAuthResult> {
    // loginUrl is a hint, not a requirement: it only decides where the search for
    // the form starts. The locator takes over from there.
    const entryUrl = config.loginUrl ?? targetUrl;
    narrator?.navigating(entryUrl);
    try {
      await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch {
      return { status: 'failed', category: 'page-load-error', reason: 'the entry page could not be loaded' };
    }

    // Fresh per login: the locator accumulates visited origins/tried controls.
    const location = await new LoginFormLocator().locate(page, config, targetUrl, narrator);
    if (!location) {
      return {
        status: 'failed',
        category: 'form-not-found',
        reason:
          'no login form was found on the target, behind any Login/Sign In control, or at a conventional auth route — supply loginUrl or usernameSelector/passwordSelector',
      };
    }

    const resolved = location.selectors;
    // Mask the username before a single character is typed: the password input
    // hides itself, the username renders in plaintext into every live frame.
    await maskField(page, resolved.username);

    const entered = await this.enterCredentials(page, resolved, config);
    if (!entered) {
      return { status: 'failed', category: 'unknown', reason: 'the resolved login fields could not be filled' };
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
    const verdict = await this.verify(page, config, resolved, formUrl, isFinalAttempt);
    return verdict.status === 'authenticated'
      ? { ...verdict, originsVisited: location.originsVisited, loginUrl: location.url }
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
   * Success oracle. An explicit indicator wins; otherwise gather the signals a
   * post-submit page yields — the password field going away (the primary success
   * signal, which survives SPA logins that never change the URL), an off-login
   * navigation, and the decisive-negative probes (CAPTCHA/MFA/lockout/auth error) —
   * then let the pure {@link classifyCredentialVerdict} policy weigh them.
   */
  private async verify(
    page: Page,
    config: TargetCredentialsAuth,
    resolved: ResolvedSelectors,
    formUrl: string,
    isFinalAttempt: boolean,
  ): Promise<TargetAuthResult> {
    if (config.successIndicator) {
      const seen = await page
        .waitForSelector(config.successIndicator, { timeout: SUCCESS_TIMEOUT_MS, state: 'visible' })
        .then(() => true)
        .catch(() => false);
      return seen
        ? { status: 'authenticated', reason: 'success indicator appeared', resolution: resolved }
        : { status: 'failed', category: 'success-indicator-missing', reason: 'the configured success indicator never appeared' };
    }

    const passwordGone = await page
      .waitForSelector(resolved.password, { timeout: SUCCESS_TIMEOUT_MS, state: 'hidden' })
      .then(() => true)
      .catch(() => false);

    const [hasCaptcha, hasMfa, hasLockout, hasAuthError] = await Promise.all([
      this.hasCaptcha(page),
      this.hasMfaPrompt(page),
      this.hasLockout(page),
      this.hasAuthError(page),
    ]);

    const signals: CredentialVerifySignals = {
      hasCaptcha,
      hasMfa,
      hasLockout,
      hasAuthError,
      passwordGone,
      urlMoved: normalizeUrl(page.url()) !== normalizeUrl(formUrl),
    };

    const verdict = classifyCredentialVerdict(signals, isFinalAttempt);
    return verdict.status === 'authenticated' ? { ...verdict, resolution: resolved } : verdict;
  }

  private hasAuthError(page: Page): Promise<boolean> {
    return this.matchesVisibleText(page, [...ERROR_AFFORDANCE_SELECTORS], AUTH_ERROR_RE);
  }

  /** A CAPTCHA challenge widget rendered on the page — form login cannot solve it. */
  private hasCaptcha(page: Page): Promise<boolean> {
    return this.hasVisibleElement(page, [...CAPTCHA_SELECTORS]);
  }

  /** A one-time-code input, or an MFA/2FA prompt in an alert/label/heading. */
  private async hasMfaPrompt(page: Page): Promise<boolean> {
    if (await this.hasVisibleElement(page, [...MFA_INPUT_SELECTORS])) return true;
    return this.matchesVisibleText(page, [...MFA_TEXT_SELECTORS], MFA_TEXT_RE);
  }

  /** Lockout / too-many-attempts / suspended-account language in a prompt. */
  private hasLockout(page: Page): Promise<boolean> {
    return this.matchesVisibleText(page, [...LOCKOUT_TEXT_SELECTORS], LOCKOUT_TEXT_RE);
  }

  /** True if any of the selectors resolves to a laid-out (visible) element. */
  private async hasVisibleElement(page: Page, selectors: string[]): Promise<boolean> {
    return page
      .evaluate(
        (sels: string[]) =>
          sels.some((selector) =>
            Array.from(document.querySelectorAll(selector)).some((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }),
          ),
        selectors,
      )
      .catch(() => false);
  }

  /** True if any selector resolves to a visible element whose text matches the pattern. */
  private async matchesVisibleText(page: Page, selectors: string[], pattern: RegExp): Promise<boolean> {
    return page
      .evaluate(
        ([sels, source, flags]: [string[], string, string]) => {
          const re = new RegExp(source, flags);
          return sels.some((selector) =>
            Array.from(document.querySelectorAll(selector)).some((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && re.test(el.textContent ?? '');
            }),
          );
        },
        [selectors, pattern.source, pattern.flags] as [string[], string, string],
      )
      .catch(() => false);
  }
}

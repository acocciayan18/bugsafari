// Pure verdict policy for a credentials login. Kept free of Playwright so the
// decision table can be asserted without a browser: TargetAuthenticator gathers
// the boolean signals via page probes, this decides the outcome + category.
//
// Precedence rationale: a decisive-negative signal (CAPTCHA, MFA step, lockout,
// visible auth error) wins BEFORE the password-gone success check, because apps
// clear the form on rejection or step to a challenge screen that would otherwise
// read as a cleared (successful) form.

import type { TargetAuthResult, TargetAuthFailureCategory } from '../../../../../shared/types.js';

/** Signals a post-submit page yields, gathered by TargetAuthenticator's probes. */
export interface CredentialVerifySignals {
  hasCaptcha: boolean;
  hasMfa: boolean;
  hasLockout: boolean;
  hasAuthError: boolean;
  passwordGone: boolean;
  urlMoved: boolean;
}

// Operator-facing, credential-free, mutually distinct reason copy for every
// verdict this classifier produces.
const REASON = {
  captcha: 'the login is protected by a CAPTCHA the engine cannot solve with a form fill',
  mfa: 'the login requires a one-time verification code (MFA) a form fill cannot complete',
  locked: 'the target reported the account is locked or has had too many sign-in attempts',
  invalidError: 'the login form reported invalid credentials',
  invalidRepeated: 'the login form is still present after submitting — the credentials appear to have been rejected',
  transient: 'the target has not confirmed the sign-in yet — it may be slow or still loading',
  cleared: 'login form cleared',
  navigated: 'the app navigated off the login page',
} as const;

function failed(category: TargetAuthFailureCategory, reason: string): TargetAuthResult {
  return { status: 'failed', category, reason };
}

/**
 * Decide a credentials-login outcome from the gathered signals. On the ambiguous
 * case (form still present, no decisive signal) the first attempt returns a
 * retryable `transient`; the final attempt reads the repeated login prompt as
 * rejected credentials.
 */
export function classifyCredentialVerdict(signals: CredentialVerifySignals, isFinalAttempt: boolean): TargetAuthResult {
  if (signals.hasCaptcha) return failed('captcha', REASON.captcha);
  if (signals.hasMfa) return failed('mfa-required', REASON.mfa);
  if (signals.hasLockout) return failed('account-locked', REASON.locked);
  if (signals.hasAuthError) return failed('invalid-credentials', REASON.invalidError);
  if (signals.passwordGone) return { status: 'authenticated', reason: REASON.cleared };
  if (signals.urlMoved) return { status: 'authenticated', reason: REASON.navigated };
  return isFinalAttempt
    ? failed('invalid-credentials', REASON.invalidRepeated)
    : failed('transient', REASON.transient);
}

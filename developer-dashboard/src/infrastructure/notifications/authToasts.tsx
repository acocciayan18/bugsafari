import { Check, ShieldAlert } from 'lucide-react';
import { toast } from './ToastProvider';
import type { AuthFeedback } from '../../utils/authFeedback';

// Auth toast policy, in one place:
//  - Failures inside a form NEVER toast — AuthAlert renders them inline, so a
//    single event is never reported twice or in two different wordings.
//  - Toasts are reserved for terminal successes and for auth events that have
//    no form to render into (session revoked mid-session).
// Wording, icon, variant and duration are fixed here so every auth surface reads
// identically.

const SUCCESS_DURATION_MS = 2500;
const EVENT_DURATION_MS = 5000;

const successIcon = <Check className="w-4 h-4" strokeWidth={1.75} />;
const alertIcon = <ShieldAlert className="w-4 h-4" strokeWidth={1.75} />;

export const AUTH_SUCCESS = {
  accountCreated: 'Account created. Redirecting to sign in…',
  resetLinkSent: 'If an account exists for that email, a reset link is on its way.',
  passwordReset: 'Password updated. Sign in with your new password.',
  signedOut: 'Signed out successfully.',
} as const;

/** Terminal success in an auth flow. */
export function authSuccessToast(message: string): void {
  toast.success(message, { icon: successIcon, duration: SUCCESS_DURATION_MS });
}

/** Auth failure with no form to render into — session revocation only. */
export function authEventToast(feedback: AuthFeedback): void {
  const text = feedback.hint ? `${feedback.message} ${feedback.hint}` : feedback.message;
  toast.error(text, { icon: alertIcon, duration: EVENT_DURATION_MS });
}

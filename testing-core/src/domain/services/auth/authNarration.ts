// Operator-facing phrasing for the target-app login sequence, kept pure so every
// message can be asserted on without a browser or a socket.
//
// Two hard rules, both enforced by the tests next to this file:
//   1. No credential material. Values are never interpolated; URLs are stripped to
//      origin + path so a `?token=` in a redirect chain cannot ride along.
//   2. Every phase reads differently. SocketTelemetryGateway's deduper collapses
//      consecutive events sharing type|actionExecuted|message, so a repeated
//      sentence would silently erase a step from the Live Feed.

import type { ActionType } from '../../../../../shared/types.js';

/**
 * ACTION codes for the auth sequence. Deliberately absent from
 * VERBOSE_ACTION_CODES (shared/types/telemetryPolicy.ts): authentication is a
 * handful of events per run that an operator must see by default, not per-step
 * execution trace.
 */
export const AUTH_ACTION = {
  started: 'auth-started',
  navigating: 'auth-navigating',
  discovering: 'auth-discovery-started',
  affordanceClicked: 'auth-affordance-clicked',
  routeProbed: 'auth-route-probed',
  formDetected: 'auth-form-detected',
  credentialsEntered: 'auth-credentials-entered',
  submitted: 'auth-submitted',
  verifying: 'auth-verifying',
  retrying: 'auth-retrying',
  succeeded: 'auth-succeeded',
  failed: 'auth-failed',
} as const;

/** One replayable login step for the reproduction playbook. Never carries a value. */
export interface AuthPlaybookStep {
  /** Breadcrumb verb — `authenticate-navigate`, `authenticate-input`, … */
  action: string;
  actionType: ActionType;
  humanIdentifier: string;
  elementKind?: string;
  url?: string;
}

/** Display form of a URL: origin + path only, so query tokens never reach an operator surface. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // about:/data:/blob: parse but have the literal string 'null' as their origin;
    // recomposing those yields nonsense ("nullblank"), so show them verbatim.
    return parsed.origin === 'null' ? url : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function describeAuthStart(mode: 'credentials' | 'storageState'): string {
  return mode === 'storageState'
    ? 'Target authentication: verifying the supplied browser session state.'
    : 'Target authentication: signing in to the target before exploration begins.';
}

export function describeNavigating(url: string): string {
  return `Opening ${safeUrl(url)} to look for the login form.`;
}

export function describeDiscovering(url: string): string {
  return `No login form on ${safeUrl(url)} — searching the application for one.`;
}

/**
 * Wrap a resolved control name for prose. A semantic fallback (`<button#submit>`)
 * is left unquoted — quoting it would read as if that were the control's label.
 */
export function controlPhrase(name: string): string {
  return name.startsWith('<') ? `the ${name} control` : `the "${name}" control`;
}

export function describeAffordanceClick(name: string, url: string): string {
  return `Clicked ${controlPhrase(name)} to reveal the login form — now on ${safeUrl(url)}.`;
}

export function describeRouteProbe(url: string): string {
  return `Probing ${safeUrl(url)} for a login form.`;
}

export function describeFormDetected(url: string): string {
  return `Login form found on ${safeUrl(url)}.`;
}

export function describeCredentialsEntered(): string {
  return 'Typed the supplied credentials into the login form (values masked).';
}

/** `name` is null when no submit control resolved and the form is sent with Enter. */
export function describeSubmitted(name: string | null): string {
  return name
    ? `Submitted the login form via ${controlPhrase(name)}.`
    : 'Submitted the login form by pressing Enter in the password field.';
}

export function describeVerifying(): string {
  return 'Waiting for the target to confirm the sign-in.';
}

export function describeAuthSucceeded(url: string): string {
  return `Authenticated — exploring the signed-in surface from ${safeUrl(url)}.`;
}

export function describeAuthRetry(reason: string): string {
  return `Sign-in has not confirmed yet (${reason}) — retrying once before giving up.`;
}

export function describeAuthFailed(reason: string): string {
  return `Target authentication failed: ${reason}. No exploration performed.`;
}

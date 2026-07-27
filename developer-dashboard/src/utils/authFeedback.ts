// ============================================================================
// authFeedback — the single translator from auth transport outcome to operator copy
// ============================================================================
// Every auth surface (login, signup, forgot password, reset password, session
// revocation) renders exactly what this module returns. Server `error` strings
// are logged, never displayed: the visible wording is derived from the stable
// `code`, so a 401 can never surface as a server outage and a 500 can never
// surface as a credential problem.

import type { AuthErrorBody, AuthErrorCode, AuthErrorField } from '../../../shared/types.js';

// Transport-level outcomes the server never gets to describe.
type ClientCode = 'NETWORK_UNREACHABLE' | 'UNEXPECTED_RESPONSE';

export type AuthFeedbackCode = AuthErrorCode | ClientCode;

export type AuthSeverity = 'validation' | 'auth' | 'permission' | 'network' | 'rateLimit' | 'server';

export interface AuthFeedback {
  code: AuthFeedbackCode;
  severity: AuthSeverity;
  /** What went wrong, one sentence. */
  message: string;
  /** What the operator can do about it. */
  hint?: string;
  /** Form control to mark invalid, when the failure is attributable to one. */
  field?: AuthErrorField;
}

interface CopyEntry {
  severity: AuthSeverity;
  message: string;
  hint?: string;
}

const COPY: Record<AuthFeedbackCode, CopyEntry> = {
  VALIDATION_FAILED: {
    severity: 'validation',
    message: 'Some details are missing or invalid.',
    hint: 'Check the highlighted fields and try again.',
  },
  PASSWORD_WEAK: {
    severity: 'validation',
    message: "That password doesn't meet the security requirements.",
    hint: 'Use at least 8 characters with one uppercase letter, one number, and one special character.',
  },
  INVALID_CREDENTIALS: {
    severity: 'auth',
    message: 'Email or password is incorrect.',
    hint: "Check your email for typos and re-enter your password. Use “Forgot password?” if you can't recall it.",
  },
  EMAIL_TAKEN: {
    severity: 'validation',
    message: 'An account with this email already exists.',
    hint: 'Sign in instead, or reset the password for that account.',
  },
  RESET_TOKEN_INVALID: {
    severity: 'auth',
    message: 'This password reset link is invalid or has expired.',
    hint: 'Reset links expire after 1 hour. Request a new one to continue.',
  },
  SESSION_REVOKED: {
    severity: 'auth',
    message: 'Your session was ended for security reasons.',
    hint: 'Sign in again to continue.',
  },
  REFRESH_INVALID: {
    severity: 'auth',
    message: 'Your session has expired.',
    hint: 'Sign in again to continue.',
  },
  FORBIDDEN: {
    severity: 'permission',
    message: "This account doesn't have access to that resource.",
    hint: 'Sign in with an account that has the required permission.',
  },
  RATE_LIMITED: {
    severity: 'rateLimit',
    message: 'Too many attempts.',
    hint: 'Wait a moment before trying again.',
  },
  NOT_FOUND: {
    severity: 'server',
    message: 'The authentication service is unavailable.',
    hint: 'Your details are fine — this is on our side. Try again shortly.',
  },
  BAD_REQUEST: {
    severity: 'validation',
    message: 'The request was rejected.',
    hint: 'Check your details and try again.',
  },
  INVALID_JSON: {
    severity: 'server',
    message: 'The request could not be read by the server.',
    hint: 'Reload the page and try again.',
  },
  PAYLOAD_TOO_LARGE: {
    severity: 'validation',
    message: 'The submitted details are too large.',
    hint: 'Shorten your input and try again.',
  },
  INTERNAL_ERROR: {
    severity: 'server',
    message: 'The server hit an unexpected error.',
    hint: 'Your details are fine — this is on our side. Try again in a moment.',
  },
  NETWORK_UNREACHABLE: {
    severity: 'network',
    message: 'Cannot reach the BugSafari server.',
    hint: 'Check your connection, confirm the API is running, then try again.',
  },
  UNEXPECTED_RESPONSE: {
    severity: 'server',
    message: 'The server returned an unexpected response.',
    hint: 'Your details are fine — this is on our side. Try again in a moment.',
  },
};

// Fallback taxonomy for responses that predate the code contract or come from an
// intermediary (proxy, load balancer) that never saw it.
function codeForStatus(status: number): AuthFeedbackCode {
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 401) return 'INVALID_CREDENTIALS';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'EMAIL_TAKEN';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'UNEXPECTED_RESPONSE';
}

function isKnownCode(value: unknown): value is AuthFeedbackCode {
  return typeof value === 'string' && value in COPY;
}

function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Build the operator-facing feedback for a code, applying per-code refinements. */
export function buildFeedback(code: AuthFeedbackCode, body?: Partial<AuthErrorBody>): AuthFeedback {
  const copy = COPY[code];
  const hint = code === 'RATE_LIMITED' && typeof body?.retryAfterSeconds === 'number'
    ? `Try again in ${formatRetryAfter(body.retryAfterSeconds)}.`
    : copy.hint;

  return {
    code,
    severity: copy.severity,
    message: copy.message,
    hint,
    field: body?.field,
  };
}

// Base URL mirrors the rest of the dashboard: empty means same-origin, which the
// Vite dev proxy forwards to the API container.
const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? '';

export type AuthRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; feedback: AuthFeedback };

/**
 * POST a JSON body to an auth route and resolve to either the parsed payload or
 * fully-translated feedback. Never throws, never surfaces a raw server string.
 */
export async function postAuth<T>(path: string, body: unknown): Promise<AuthRequestResult<T>> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error(`[auth] ${path} transport failure:`, error);
    return { ok: false, feedback: buildFeedback('NETWORK_UNREACHABLE') };
  }

  // A proxy or crashed process can answer with HTML; parse defensively so the
  // status still drives the classification instead of a JSON syntax error.
  const payload = await response.json().catch(() => null) as (Partial<AuthErrorBody> & T) | null;

  if (!response.ok) {
    const code = isKnownCode(payload?.code) ? payload.code : codeForStatus(response.status);
    console.error(`[auth] ${path} -> ${response.status} ${code}: ${payload?.error ?? '<no body>'}`);
    return { ok: false, feedback: buildFeedback(code, payload ?? undefined) };
  }

  if (!payload) {
    console.error(`[auth] ${path} -> ${response.status} with unreadable body`);
    return { ok: false, feedback: buildFeedback('UNEXPECTED_RESPONSE') };
  }

  return { ok: true, data: payload };
}

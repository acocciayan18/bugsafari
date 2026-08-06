// ═══════════════════════════════════════════════════════════════
// shared/types/authError.ts — OPERATOR AUTH ERROR CONTRACT
// ═══════════════════════════════════════════════════════════════
// Machine-readable failure contract for BugSafari's own operator auth routes
// (login / signup / password reset / refresh) — unrelated to target-app auth
// in ./auth.ts.
//
// INVARIANT: `code` is the ONLY field the dashboard branches on. `error` is a
// short server-authored string kept for logs and non-UI clients; the operator
// copy is derived from `code` on the frontend so wording stays consistent and
// no internal detail (stack, driver text, enumeration signal) can leak into a
// toast or alert.

/** Stable failure taxonomy. Every auth response body carries exactly one. */
export type AuthErrorCode =
  | 'VALIDATION_FAILED'
  | 'PASSWORD_WEAK'
  | 'PASSWORD_REUSED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'EMAIL_UNVERIFIED'
  | 'VERIFICATION_TOKEN_INVALID'
  | 'EMAIL_SEND_FAILED'
  | 'RESET_TOKEN_INVALID'
  | 'SESSION_REVOKED'
  | 'REFRESH_INVALID'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

/** Form control the failure belongs to, when it is attributable to one. */
export type AuthErrorField = 'email' | 'password' | 'confirmPassword' | 'token';

export interface AuthErrorBody {
  error: string;
  code: AuthErrorCode;
  field?: AuthErrorField;
  /** Present on RATE_LIMITED only — drives the "try again in N" copy. */
  retryAfterSeconds?: number;
}

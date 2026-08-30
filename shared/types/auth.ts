// ═══════════════════════════════════════════════════════════════
// shared/types/auth.ts — TARGET-APPLICATION AUTHENTICATION
// ═══════════════════════════════════════════════════════════════
// Credentials for the application UNDER TEST — unrelated to BugSafari's own
// operator accounts (see presentation/authentication).
//
// INVARIANT: ephemeral, and never stored in plaintext. These values live in
// memory for the duration of one run and are never written to MongoDB, logs,
// reports, telemetry, or a BullMQ job payload (which Redis retains for 24h on
// failure). Anything that persists or broadcasts a run config must exclude them.
//
// The ONE permitted crossing of a process boundary is the AuthVault
// (testing-core/src/infrastructure/queue/AuthVault.ts): AES-256-GCM sealed under
// BUGSAFARI_AUTH_KEY, keyed by runId, 10-minute TTL, destroyed on first read.
// That is what makes an authenticated run safe to queue; the job payload itself
// carries only a `hasAuth` marker.

/** Form login driven by the engine against the target's own login page. */
export interface TargetCredentialsAuth {
  mode: 'credentials';
  /**
   * Where to start looking for the login form. A hint, not a requirement — the
   * engine discovers the form from here (in-page, behind a Login/Sign In control,
   * or at a conventional auth route). Defaults to the run's target URL.
   */
  loginUrl?: string;
  /** Explicit selectors; omitted fields fall back to DOM auto-detection. */
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  username: string;
  password: string;
  /** Selector that must appear post-login to declare success. */
  successIndicator?: string;
}

/** Ephemeral target-app authentication supplied per run. Never persisted. */
export type TargetAuthConfig = TargetCredentialsAuth;

/**
 * Why an authentication attempt failed. Drives the retry gate and lets every
 * surface name the failure precisely instead of a single generic sentence. Only
 * meaningful when `status === 'failed'`.
 */
export type TargetAuthFailureCategory =
  | 'invalid-credentials'       // the target rejected the username/password
  | 'mfa-required'              // a one-time-code / 2FA step a form fill cannot complete
  | 'captcha'                   // a CAPTCHA challenge blocks the form
  | 'account-locked'            // lockout / too-many-attempts / suspended
  | 'form-not-found'            // no login form discoverable on the target
  | 'unsupported-auth-method'   // only OAuth/SSO/social sign-in offered — a form fill cannot complete it
  | 'success-indicator-missing' // the configured success selector never appeared
  | 'page-load-error'           // the page/entry URL could not be loaded (retryable)
  | 'transient'                 // no decisive signal yet — likely slow/loading (retryable)
  | 'unknown';                  // fell through with no classifiable signal

// Only genuinely non-decisive failures retry: a visible rejection, MFA, CAPTCHA,
// or lockout must NOT re-submit (a second attempt could trip a lockout).
export const RETRYABLE_AUTH_CATEGORIES: readonly TargetAuthFailureCategory[] = ['page-load-error', 'transient'];

export function isRetryableAuthFailure(category?: TargetAuthFailureCategory): boolean {
  return category !== undefined && RETRYABLE_AUTH_CATEGORIES.includes(category);
}

/** Outcome of an authentication attempt. Carries no credential material. */
export interface TargetAuthResult {
  status: 'authenticated' | 'failed' | 'skipped';
  /** Operator-facing reason. MUST NOT contain the username or password. */
  reason: string;
  /** Classified failure cause. Set when `status === 'failed'`; drives the retry gate. */
  category?: TargetAuthFailureCategory;
  /** Which selector resolved each field — for operator debugging, never values. */
  resolution?: { username: string; password: string; submit: string };
  /**
   * The URL the login form was actually found at. Set on a successful credential
   * login so an in-run re-auth (session-restore) can navigate straight back to the
   * discovered form instead of re-guessing conventional auth routes.
   */
  loginUrl?: string;
  /**
   * Origins the login traversed, including any identity provider a Sign In control
   * redirected to. The engine unions these into its boundary allow-list so a
   * mid-run bounce back to the IdP is not treated as leaving the target.
   */
  originsVisited?: string[];
}

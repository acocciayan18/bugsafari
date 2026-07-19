// ═══════════════════════════════════════════════════════════════
// shared/types/auth.ts — TARGET-APPLICATION AUTHENTICATION
// ═══════════════════════════════════════════════════════════════
// Credentials for the application UNDER TEST — unrelated to BugSafari's own
// operator accounts (see presentation/authentication).
//
// INVARIANT: ephemeral. These values live in memory for the duration of one run
// and are never written to MongoDB, Redis, logs, reports, or telemetry. Anything
// that would persist or broadcast a run config must exclude this object.

/** Ephemeral target-app credentials supplied per run. Never persisted. */
export interface TargetAuthConfig {
  /** Page hosting the login form. Defaults to the run's target URL. */
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

/** Outcome of an authentication attempt. Carries no credential material. */
export interface TargetAuthResult {
  status: 'authenticated' | 'failed' | 'skipped';
  /** Operator-facing reason. MUST NOT contain the username or password. */
  reason: string;
  /** Which selector resolved each field — for operator debugging, never values. */
  resolution?: { username: string; password: string; submit: string };
}

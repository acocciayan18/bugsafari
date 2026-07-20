// ═══════════════════════════════════════════════════════════════
// shared/types/auth.ts — TARGET-APPLICATION AUTHENTICATION
// ═══════════════════════════════════════════════════════════════
// Credentials for the application UNDER TEST — unrelated to BugSafari's own
// operator accounts (see presentation/authentication).
//
// INVARIANT: ephemeral. These values live in memory for the duration of one run
// and are never written to MongoDB, Redis, logs, reports, or telemetry. Anything
// that would persist or broadcast a run config must exclude this object.

/** Form login driven by the engine against the target's own login page. */
export interface TargetCredentialsAuth {
  mode: 'credentials';
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

/**
 * Pre-authenticated browser state, seeded into the context before the app boots.
 * Covers targets whose login a form fill cannot drive — SSO/OAuth redirects, MFA,
 * captcha — by reusing a session the operator established out of band.
 */
export interface TargetStorageStateAuth {
  mode: 'storageState';
  /** Serialized Playwright storageState JSON. Contains live session tokens — secret. */
  storageState: string;
  /** Selector proving the seeded session is still valid. Defaults to a login-wall probe. */
  successIndicator?: string;
}

/** Ephemeral target-app authentication supplied per run. Never persisted. */
export type TargetAuthConfig = TargetCredentialsAuth | TargetStorageStateAuth;

/** Shape Playwright accepts for `newContext({ storageState })`. */
export interface PlaywrightStorageState {
  cookies: unknown[];
  origins: unknown[];
}

/** Parse + structurally validate a serialized storageState. Returns null when unusable. */
export function parseStorageState(raw: string): PlaywrightStorageState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { cookies, origins } = parsed as Partial<PlaywrightStorageState>;
    if (!Array.isArray(cookies) || !Array.isArray(origins)) return null;
    if (cookies.length === 0 && origins.length === 0) return null;
    return { cookies, origins };
  } catch {
    return null;
  }
}

/** Outcome of an authentication attempt. Carries no credential material. */
export interface TargetAuthResult {
  status: 'authenticated' | 'failed' | 'skipped';
  /** Operator-facing reason. MUST NOT contain the username or password. */
  reason: string;
  /** Which selector resolved each field — for operator debugging, never values. */
  resolution?: { username: string; password: string; submit: string };
}

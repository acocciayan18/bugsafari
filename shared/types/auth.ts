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

// Hard caps on a storageState (SEC-08): a caller-supplied jar is seeded straight
// into a browser context, so it is bounded in size, count, and — when a target host
// is known — domain scope.
const MAX_STORAGE_STATE_BYTES = 256 * 1024;
const MAX_COOKIES = 100;
const MAX_ORIGINS = 50;
const MAX_LOCALSTORAGE_ITEMS = 200;
const MAX_FIELD_LEN = 4096;

export interface ParseStorageStateOptions {
  /** When set, every cookie/origin must fall within this host's registrable domain. */
  targetHost?: string;
}

// eTLD+1-approximate scope check (no PSL dependency): in-scope means the cookie
// domain equals the target host, is a parent domain of it, or is a subdomain of it.
// Blocks cross-site jars (evil.com, 169.254.169.254) while allowing parent-domain
// cookies. Multi-part suffixes (co.uk) are handled conservatively by the shared-suffix
// relationship; a full PSL is the ideal and is noted as a follow-up.
function domainInScope(cookieDomain: string, targetHost: string): boolean {
  const d = cookieDomain.trim().replace(/^\./, '').toLowerCase();
  const h = targetHost.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!d || !d.includes('.') || !h) return false;
  if (d === h) return true;
  if (h.endsWith('.' + d)) return true; // cookie on a parent domain of the target
  if (d.endsWith('.' + h)) return true; // cookie on a subdomain of the target
  return false;
}

function isValidCookie(c: unknown, targetHost?: string): boolean {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > MAX_FIELD_LEN) return false;
  if (typeof o.value !== 'string' || o.value.length > MAX_FIELD_LEN) return false;
  if (o.domain !== undefined && (typeof o.domain !== 'string' || o.domain.length > MAX_FIELD_LEN)) return false;
  if (o.path !== undefined && (typeof o.path !== 'string' || o.path.length > MAX_FIELD_LEN)) return false;
  if (o.expires !== undefined && typeof o.expires !== 'number') return false;
  if (o.httpOnly !== undefined && typeof o.httpOnly !== 'boolean') return false;
  if (o.secure !== undefined && typeof o.secure !== 'boolean') return false;
  if (o.sameSite !== undefined && (o.sameSite !== 'Strict' && o.sameSite !== 'Lax' && o.sameSite !== 'None')) return false;
  if (targetHost && (typeof o.domain !== 'string' || !domainInScope(o.domain, targetHost))) return false;
  return true;
}

function isValidOrigin(entry: unknown, targetHost?: string): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const o = entry as Record<string, unknown>;
  if (typeof o.origin !== 'string' || o.origin.length === 0 || o.origin.length > MAX_FIELD_LEN) return false;
  const ls = o.localStorage;
  if (ls !== undefined) {
    if (!Array.isArray(ls) || ls.length > MAX_LOCALSTORAGE_ITEMS) return false;
    for (const item of ls) {
      if (!item || typeof item !== 'object') return false;
      const it = item as Record<string, unknown>;
      if (typeof it.name !== 'string' || it.name.length > MAX_FIELD_LEN) return false;
      if (typeof it.value !== 'string' || it.value.length > MAX_FIELD_LEN) return false;
    }
  }
  if (targetHost) {
    let host: string;
    try { host = new URL(o.origin).hostname; } catch { return false; }
    if (!domainInScope(host, targetHost)) return false;
  }
  return true;
}

/**
 * Parse + deeply validate a serialized storageState (SEC-08). Rejects — never
 * silently drops — a jar that is oversized, over-count, malformed per entry, or (when
 * `targetHost` is supplied) carries a cookie/origin outside the target's domain. A
 * partial drop would produce a misleadingly "clean" authenticated run.
 */
export function parseStorageState(raw: string, options?: ParseStorageStateOptions): PlaywrightStorageState | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_STORAGE_STATE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { cookies, origins } = parsed as Partial<PlaywrightStorageState>;
    if (!Array.isArray(cookies) || !Array.isArray(origins)) return null;
    if (cookies.length === 0 && origins.length === 0) return null;
    if (cookies.length > MAX_COOKIES || origins.length > MAX_ORIGINS) return null;
    const host = options?.targetHost;
    if (!cookies.every((c) => isValidCookie(c, host))) return null;
    if (!origins.every((o) => isValidOrigin(o, host))) return null;
    return { cookies, origins };
  } catch {
    return null;
  }
}

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
  | 'success-indicator-missing' // the configured success selector never appeared
  | 'session-expired'           // storageState mode: the seeded session was rejected
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

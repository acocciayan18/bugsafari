import type { Page } from 'playwright';

// Centralized session-preservation policy for authenticated exploratory runs.
// Pure, deterministic classification (no RNG, no DOM, no I/O) plus a small
// stateful restore coordinator. Reused identically by the scoring stage
// (demotion), the execution stage (hard veto), and the navigation monitor
// (auth-page detection + restore). Inert on guest/unauthenticated runs — every
// call site gates on the engine's authenticated-run flag before consulting it.

// Session-exit demotion, applied only to authenticated runs. Larger than every
// other ExplorationLoop demotion so a session-destroying control is genuinely
// last-resort in ranking; the execution veto then blocks the click outright.
export const SESSION_EXIT_DEMOTION = 2000;

// Minimal element shape the classifier reads — visible text and identifying
// attributes only. Tag/type are irrelevant: a destructive control is identified
// by what it says, not what it is.
export interface SessionControlClassifiable {
  innerText?: string;
  id?: string;
  className?: string;
}

// Session-destroying control patterns. Each ends or replaces the authenticated
// session: sign-out, re-login/registration, account switch/deletion, credential
// reset, or token/session revocation. Delete/remove/close match ONLY when
// anchored to account|profile so generic CRUD (delete item, remove row) stays
// fully explorable — a testing engine must still exercise those.
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /log[\s_-]?out/i,
  /sign[\s_-]?out/i,
  /log[\s_-]?off/i,
  /end[\s_-]?session/i,
  /\bre-?log[\s_-]?in\b/i,
  /\blog[\s_-]?in\b/i,
  /\bsign[\s_-]?in\b/i,
  /\bsign[\s_-]?up\b/i,
  /\bregister\b/i,
  /create[\s_-]?account/i,
  /(switch|change|add|remove)[\s_-]?account/i,
  /(delete|deactivate|close|remove|terminate|deregister)[\w\s_-]{0,12}(account|profile)/i,
  /(account|profile)[\w\s_-]{0,12}(delete|deactivat|closure|removal|terminat)/i,
  /revoke[\w\s_-]{0,16}(token|session|access|api[\s_-]?key|key|credential)/i,
  /token[\s_-]?revocation/i,
  /(reset|change|update|forgot)[\w\s_-]{0,12}password/i,
];

// True when an element's text/attributes identify it as a session-destroying
// control. Superset of the old isSessionExitControl (which caught logout only).
export function isSessionDestroyingControl(element: SessionControlClassifiable): boolean {
  const haystack = `${element.innerText ?? ''} ${element.id ?? ''} ${element.className ?? ''}`;
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(haystack));
}

// Alias for the execution-stage veto — same predicate, intent-named at its call site.
export function shouldVetoExecution(element: SessionControlClassifiable): boolean {
  return isSessionDestroyingControl(element);
}

// Authentication route segments. A navigation landing on one of these during an
// authenticated run means the session was lost (a redirect bounced to login).
const AUTH_PATH_RE = /(^|\/)(login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|signout|sign-out|auth|sso)(\/|$)/i;

// True when a URL's path is an authentication page. Path-only + deterministic:
// query/hash are ignored so /dashboard?tab=login is not misread as a login page.
export function isAuthPage(url: string): boolean {
  try {
    return AUTH_PATH_RE.test(new URL(url).pathname);
  } catch {
    return AUTH_PATH_RE.test(url);
  }
}

// Descriptor for a detected session loss, consumed by the navigation monitor to
// build the SESSION_SYNC_FAULT incident. No catalog fields here — the engine
// attaches title/severity/CWE from BUG_CATALOG to keep this module dependency-light.
export interface SessionLossDescriptor {
  reason: string;
  from: string;
  to: string;
}

// True when a navigation should be treated as a session loss: an authenticated
// run (not mid-restore) landed on an auth page it wasn't already on. The single
// gate the navigation monitor consults, so its exact condition is unit-testable.
export function shouldTriggerSessionLoss(
  authenticatedRun: boolean,
  isRestoring: boolean,
  from: string,
  to: string,
): boolean {
  return authenticatedRun && !isRestoring && isAuthPage(to) && !isAuthPage(from);
}

// Classify an unexpected authenticated -> auth-page transition as a session loss.
export function classifySessionLoss(from: string, to: string): SessionLossDescriptor {
  return {
    reason: `Authenticated session lost — navigation bounced to an authentication page (${to}).`,
    from,
    to,
  };
}

// Restores an authenticated session in place. Returns true on success. Injected
// by PlaywrightBrowserEngine (which holds the credentials/state); the engine
// only ever sees this opaque callback, never the auth config (least privilege).
export type SessionRestoreFn = (page: Page) => Promise<boolean>;

// Serializes restore attempts and debounces the restore navigation's own events.
// The nav monitor fires synchronously per framenavigated; restore() flips
// `restoring` before it awaits so a re-entrant onNavigated during the restore
// reload sees isRestoring and bails instead of stacking restores.
export class SessionRestoreCoordinator {
  private restoring = false;

  constructor(private readonly restoreFn: SessionRestoreFn | null) {}

  get isRestoring(): boolean {
    return this.restoring;
  }

  canRestore(): boolean {
    return this.restoreFn !== null;
  }

  async restore(page: Page): Promise<boolean> {
    if (!this.restoreFn || this.restoring) return false;
    this.restoring = true;
    try {
      return await this.restoreFn(page);
    } catch {
      return false;
    } finally {
      this.restoring = false;
    }
  }
}

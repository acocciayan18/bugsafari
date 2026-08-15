import type { Page, Route, Request } from 'playwright';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import { canonicalHost, isWithinTargetSite, isPrivateTargetUrl, isProtectedTargetUrl } from '../../../../../shared/url.js';
import type { OptimizationSettings } from '../../../../../shared/types.js';

// Only real application navigations are subject to confinement. Every other
// scheme is a browser-internal / non-navigational transition (blank frames,
// inline data, script execution, downloads, mail/tel handlers, devtools, etc.)
// and MUST be allowed through untouched — blocking them causes false boundary
// violations, empty-page lockups, and broken in-page interactions.
const APP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// Confinement scope:
//  • 'exact'   — pin to one URL (origin+path+query); the opt-in strict URL lock.
//  • 'subtree' — pin to the launch route + its descendant paths (prefix lock);
//                the default. Auth origins still pass so login never breaks.
//  • 'site'    — pin to the target host, its subdomains, and any auth origins; the
//                fallback that keeps exploration from wandering off-site.
export type UrlLockScope = 'exact' | 'subtree' | 'site';

export interface UrlLockOptions {
  scope?: UrlLockScope;
  authOrigins?: readonly string[]; // 'site'/'subtree' scopes — extra allowed hosts (SSO).
  // Defer confinement past the initial navigation so the launch redirect chain can
  // resolve the canonical URL; relock() then pins the boundary to it. Default off.
  deferInitialLock?: boolean;
}

// Resolve the persisted OptimizationSettings flags into an active scope.
// Precedence: exact > subtree > site.
export function resolveUrlLockScope(settings?: Partial<OptimizationSettings> | null): UrlLockScope {
  if (settings?.strictUrlLock) return 'exact';
  if (settings?.subtreeLock) return 'subtree';
  return 'site';
}

/**
 * Proactive Page Boundary Lock. Installed on the page BEFORE the initial
 * navigation, it PREVENTS the main frame from leaving the boundary rather than
 * reactively correcting drift after it commits.
 *
 * Two cooperating layers, both driven by the same allow test:
 *  1. Playwright route interceptor — aborts off-boundary http/https main-frame
 *     document navigations before they commit; everything else falls through.
 *  2. addInitScript client sandbox — neutralizes client-driven location changes
 *     the network layer can't observe (location.assign/replace, history
 *     push/replaceState, anchor/form navigations), applying the identical test so
 *     it never fights the browser.
 *
 * Browser-managed schemes (about:blank, data:, blob:, javascript:, chrome:,
 * mailto:, tel:, file:, ws: …) and pure fragment (hash) changes are treated as
 * internal transitions and pass through in both scopes.
 */
export class StrictUrlLockGuard {
  /** Canonical http/https confinement key for the lock, or null if unparseable. */
  private lockKey: string | null = null;
  private readonly scope: UrlLockScope;
  /**
   * Injected-sandbox allow list. 'site': target host + auth origins. 'subtree':
   * auth origins ONLY (the target host is governed by the path-prefix rule, not a
   * bare host match). 'exact': empty.
   */
  private allowedHosts: string[] = [];
  // Confinement is inert until armed. Deferred-lock mode (initial navigation) stays
  // unarmed so the launch redirect chain reaches the canonical URL; relock() then
  // pins the boundary to it. Immediate mode arms at construction.
  private armed: boolean;
  // Captured at install so relock() can re-inject the client sandbox on the live page.
  private page: Page | null = null;

  constructor(
    private lockedUrl: string,
    private readonly telemetry: TelemetryEmitter,
    private readonly options: UrlLockOptions = {},
  ) {
    this.scope = options.scope ?? 'exact';
    this.applyLock();
    this.armed = options.deferInitialLock !== true;
  }

  // (Re)derive the confinement key + injected-sandbox allow list from lockedUrl.
  private applyLock(): void {
    this.lockKey = StrictUrlLockGuard.confinementKey(this.lockedUrl);
    const authHosts = (this.options.authOrigins ?? []).map(canonicalHost).filter(Boolean);
    this.allowedHosts =
      this.scope === 'site'
        ? [canonicalHost(this.lockedUrl), ...authHosts].filter(Boolean)
        : this.scope === 'subtree'
          ? authHosts
          : [];
  }

  /**
   * Pin the boundary to the canonical URL resolved after the initial navigation
   * (page.url() post-redirect) and arm enforcement. Called once, immediately after
   * the first load. Re-injects the client sandbox so the live document and every
   * future one confine to the canonical URL.
   */
  public async relock(canonicalUrl: string): Promise<void> {
    this.lockedUrl = canonicalUrl;
    this.applyLock();
    this.armed = true;
    if (this.page) await this.installClientSandbox(this.page, true);
  }

  /**
   * Node-side confinement key, mirrored exactly by the injected browser script.
   * Returns null for non-http(s) URLs (not subject to confinement). Hash is
   * intentionally excluded — a fragment change is an in-page transition, not a
   * navigation away from the app. A lone trailing slash on the path is tolerated.
   *
   * Public so drift detection (PageHealthGuard) shares the exact same key logic
   * as enforcement — detection can never diverge from what the guard blocks.
   */
  public static confinementKey(raw: string, base?: string): string | null {
    let u: URL;
    try {
      u = base !== undefined ? new URL(raw, base) : new URL(raw);
    } catch {
      return null;
    }
    if (!APP_PROTOCOLS.has(u.protocol)) {
      return null;
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host}${path}${u.search}`;
  }

  /**
   * Origin + normalized path of a URL, or null when not an http(s) app URL. The
   * search string is intentionally dropped — the sub-tree test is on the path.
   */
  private static subtreeParts(raw: string, base?: string): { origin: string; path: string } | null {
    let u: URL;
    try {
      u = base !== undefined ? new URL(raw, base) : new URL(raw);
    } catch {
      return null;
    }
    if (!APP_PROTOCOLS.has(u.protocol)) {
      return null;
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return { origin: `${u.protocol}//${u.host}`, path };
  }

  /** True when `url`'s host matches any of the canonical `hosts` (or a subdomain). */
  private static hostAllowed(url: string, hosts: readonly string[]): boolean {
    if (hosts.length === 0) return false;
    let host: string;
    try {
      host = canonicalHost(new URL(url).hostname);
    } catch {
      return false;
    }
    if (!host) return false;
    return hosts
      .map(canonicalHost)
      .filter(Boolean)
      .some((h) => host === h || host.endsWith('.' + h));
  }

  /**
   * Canonical Node-side allow test for every scope, shared by the guard, drift
   * detection (PageHealthGuard), and loop classification (ExplorationLoop) so the
   * three can never diverge. Non-http(s) targets are browser-internal → allowed.
   */
  public static isAllowed(
    url: string,
    lockedUrl: string,
    scope: UrlLockScope,
    authOrigins: readonly string[] = [],
  ): boolean {
    if (scope === 'site') {
      return isWithinTargetSite(url, lockedUrl, authOrigins);
    }
    if (scope === 'subtree') {
      const target = StrictUrlLockGuard.subtreeParts(lockedUrl);
      const current = StrictUrlLockGuard.subtreeParts(url);
      if (current === null || target === null) return true;
      if (StrictUrlLockGuard.hostAllowed(url, authOrigins)) return true;
      if (current.origin !== target.origin) return false;
      const prefix = target.path === '/' ? '/' : target.path + '/';
      return current.path === target.path || current.path.startsWith(prefix);
    }
    const key = StrictUrlLockGuard.confinementKey(url);
    const lockKey = StrictUrlLockGuard.confinementKey(lockedUrl);
    // Non-http(s) target, or a lock that was itself non-http(s) → browser internal.
    return key === null || lockKey === null || key === lockKey;
  }

  /** True when the main frame may navigate to `url` under the active scope. */
  private nodeAllows(url: string): boolean {
    return StrictUrlLockGuard.isAllowed(url, this.lockedUrl, this.scope, this.options.authOrigins ?? []);
  }

  /**
   * Install both layers. MUST be called before the first page.goto so the init
   * script is present for the initial document and every subsequent frame, and
   * the route interceptor is armed for the very first navigation.
   */
  public async install(page: Page): Promise<void> {
    this.page = page;
    // Deferred-lock mode injects the sandbox at relock (with the canonical URL); an
    // immediately-armed guard installs it now.
    if (this.armed) await this.installClientSandbox(page);
    await this.installRouteInterceptor(page);
  }

  // ── Layer 1: network-level main-frame navigation blocking ──────────────────
  private async installRouteInterceptor(page: Page): Promise<void> {
    const mainFrame = page.mainFrame();

    const handler = async (route: Route, request: Request): Promise<void> => {
      // Only a main-frame *document* navigation can leave the boundary. Let
      // everything else (assets, xhr/fetch, sub-frames) through untouched. This
      // guard is registered first, so it runs LAST in Playwright's reverse
      // handler order — any handler that wanted the request (e.g. NetworkSaboteur)
      // has already taken it, so continue() is the unambiguous terminal action.
      if (!request.isNavigationRequest() || request.frame() !== mainFrame) {
        await this.allow(route);
        return;
      }

      // Unarmed (initial navigation): let the main-frame redirect chain through so it
      // can settle on the canonical URL before the boundary is pinned to it — but never
      // to a private/internal host (SSRF via a public alias's redirect) nor to a
      // BugSafari host (recursive self-test via a shortened/aliased link whose typed
      // host passed admission but whose destination is BugSafari itself). Blocking here
      // is the runtime backstop for a redirect target that changed after admission.
      if (!this.armed) {
        if (isPrivateTargetUrl(request.url()) || isProtectedTargetUrl(request.url())) {
          await this.abort(route);
          return;
        }
        await this.allow(route);
        return;
      }

      if (this.nodeAllows(request.url())) {
        await this.allow(route);
        return;
      }

      // Genuine off-boundary http(s) main-frame navigation — abort pre-commit.
      await this.abort(route);
      this.telemetry.emit('ACTION', {
        actionExecuted: this.blockedAction(),
        url: request.url(),
        message: this.blockedMessage(request.url()),
      });
    };

    await page.route('**/*', handler);
  }

  private blockedAction(): string {
    if (this.scope === 'site') return 'off-site-nav-blocked';
    if (this.scope === 'subtree') return 'subtree-lock-blocked';
    return 'strict-url-lock-blocked';
  }

  private blockedMessage(url: string): string {
    if (this.scope === 'site') {
      return ` Off-site navigation blocked: ${url} leaves the app under test (${this.lockedUrl}).`;
    }
    if (this.scope === 'subtree') {
      return ` Sub-Tree Lock: blocked navigation to ${url} (outside the launch route ${this.lockedUrl}).`;
    }
    return ` Strict URL Lock: blocked navigation to ${url} (locked to ${this.lockedUrl}).`;
  }

  private async allow(route: Route): Promise<void> {
    try {
      await route.continue();
    } catch {
      // Page/context torn down mid-flight, or route already handled — non-fatal.
    }
  }

  private async abort(route: Route): Promise<void> {
    try {
      await route.abort('aborted');
    } catch {
      // Page/context torn down mid-flight, or route already handled — non-fatal.
    }
  }

  // ── Layer 2: client-side navigation sandbox (runs before page scripts) ─────
  private async installClientSandbox(page: Page, applyToCurrent = false): Promise<void> {
    const sandbox = (cfg: { scope: UrlLockScope; lockedUrl: string; allowedHosts: string[] }) => {
        // ── Runs in the browser at document start, before any page script. ──

        // Confine only the top-level application frame. Cross-origin sub-frames
        // throw on window.top access; treat any non-top / inaccessible context as
        // "not the app frame" and skip enforcement entirely (avoids iframe and
        // blank-frame false positives / loops).
        let isTopFrame = true;
        try {
          isTopFrame = window.top === window.self;
        } catch {
          isTopFrame = false;
        }
        if (!isTopFrame) {
          return;
        }

        const APP_PROTOCOLS = ['http:', 'https:'];

        // True only for a genuine http(s) navigation that leaves the boundary.
        // Browser-internal schemes, fragment-only changes, and unresolvable
        // targets all return false so they proceed normally. `base` defends
        // against empty/about:blank contexts.
        let leavesBoundary: (target: string) => boolean;

        if (cfg.scope === 'site') {
          const allowed = cfg.allowedHosts;
          if (allowed.length === 0) {
            return; // nothing to confine to — fail safe (never block everything).
          }
          // Mirror of the Node-side canonicalHost for a bare hostname.
          const canon = (h: string): string =>
            h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
          leavesBoundary = (target: string): boolean => {
            let u: URL;
            try {
              u = new URL(target, window.location.href);
            } catch {
              return false;
            }
            if (APP_PROTOCOLS.indexOf(u.protocol) === -1) {
              return false;
            }
            const host = canon(u.hostname);
            if (!host) {
              return false;
            }
            return !allowed.some((h) => host === h || host.endsWith('.' + h));
          };
        } else if (cfg.scope === 'subtree') {
          // Mirror of the Node-side sub-tree rule: same origin AND path under the
          // launch route's prefix. Auth origins (allowedHosts) always pass.
          const canon = (h: string): string =>
            h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
          const partsOf = (raw: string, base?: string): { origin: string; path: string } | null => {
            let u: URL;
            try {
              u = base !== undefined ? new URL(raw, base) : new URL(raw);
            } catch {
              return null;
            }
            if (APP_PROTOCOLS.indexOf(u.protocol) === -1) {
              return null;
            }
            const path = u.pathname.replace(/\/+$/, '') || '/';
            return { origin: `${u.protocol}//${u.host}`, path };
          };
          const target = partsOf(cfg.lockedUrl);
          if (target === null) {
            return; // lock isn't an http(s) app URL — nothing to confine.
          }
          const prefix = target.path === '/' ? '/' : target.path + '/';
          const authHosts = cfg.allowedHosts;
          leavesBoundary = (t: string): boolean => {
            const current = partsOf(t, window.location.href);
            if (current === null) {
              return false;
            }
            try {
              const host = canon(new URL(t, window.location.href).hostname);
              if (host && authHosts.some((h) => host === h || host.endsWith('.' + h))) {
                return false; // auth origin — always allowed
              }
            } catch {
              // fall through to the path test
            }
            if (current.origin !== target.origin) {
              return true;
            }
            return !(current.path === target.path || current.path.startsWith(prefix));
          };
        } else {
          // Mirror of the Node-side confinement key. Returns null when the URL is
          // unparseable or not http/https — i.e. NOT subject to confinement.
          const keyOf = (raw: string, base?: string): string | null => {
            let u: URL;
            try {
              u = base !== undefined ? new URL(raw, base) : new URL(raw);
            } catch {
              return null;
            }
            if (APP_PROTOCOLS.indexOf(u.protocol) === -1) {
              return null;
            }
            const path = u.pathname.replace(/\/+$/, '') || '/';
            return `${u.protocol}//${u.host}${path}${u.search}`;
          };
          const lockKey = keyOf(cfg.lockedUrl);
          if (lockKey === null) {
            return; // lock isn't an http(s) app URL — nothing to confine.
          }
          leavesBoundary = (target: string): boolean => {
            const targetKey = keyOf(target, window.location.href);
            if (targetKey === null) {
              return false;
            }
            return targetKey !== lockKey;
          };
        }

        // 1. location.assign / location.replace — swallow off-boundary targets.
        (['assign', 'replace'] as const).forEach((name) => {
          try {
            const original = window.location[name].bind(window.location);
            Object.defineProperty(window.location, name, {
              configurable: true,
              writable: true,
              value: (url: string | URL) => {
                if (leavesBoundary(String(url))) return; // blocked
                original(String(url));
              },
            });
          } catch {
            // Location props may be non-configurable; the network layer still
            // backstops any real document navigation. Best-effort.
          }
        });

        // 2. history.pushState / replaceState — block only cross-URL app routing.
        (['pushState', 'replaceState'] as const).forEach((name) => {
          try {
            const original = history[name].bind(history);
            history[name] = function (
              data: unknown,
              unused: string,
              url?: string | URL | null,
            ): void {
              if (url != null && leavesBoundary(String(url))) return; // blocked
              original(data, unused, url ?? null);
            } as History[typeof name];
          } catch {
            // history methods non-writable in some contexts; best-effort.
          }
        });

        // 3. Anchor clicks (capture phase) — cancel navigations that leave the
        //    boundary. javascript:/mailto:/tel:/#fragment hrefs return false from
        //    leavesBoundary and are never cancelled, so in-page behavior holds.
        document.addEventListener(
          'click',
          (event: MouseEvent) => {
            const target = event.target as Element | null;
            const anchor = target && target.closest ? target.closest('a') : null;
            if (anchor && anchor.href && leavesBoundary(anchor.href)) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
          },
          true,
        );

        // 4. Form submissions (capture phase) — cancel submits that leave the boundary.
        document.addEventListener(
          'submit',
          (event: Event) => {
            const form = event.target as HTMLFormElement | null;
            if (!form) return;
            const action = form.getAttribute('action') ?? window.location.href;
            if (leavesBoundary(action)) {
              event.preventDefault();
              event.stopImmediatePropagation();
            }
          },
          true,
        );
      };

    const cfg = { scope: this.scope, lockedUrl: this.lockedUrl, allowedHosts: this.allowedHosts };
    // Future documents (reloads, SPA sub-docs, iframes) run it at document-start.
    await page.addInitScript(sandbox, cfg);
    // The live document (already past document-start) needs it applied directly —
    // relock uses this so the canonical boundary takes effect without a reload.
    if (applyToCurrent) {
      try {
        await page.evaluate(sandbox, cfg);
      } catch {
        // Current document navigating/closed — future documents stay covered by addInitScript.
      }
    }
  }
}

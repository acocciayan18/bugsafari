import type { Page, Route, Request } from 'playwright';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import { canonicalHost, isWithinTargetSite } from '../../../../../shared/url.js';

// Only real application navigations are subject to confinement. Every other
// scheme is a browser-internal / non-navigational transition (blank frames,
// inline data, script execution, downloads, mail/tel handlers, devtools, etc.)
// and MUST be allowed through untouched — blocking them causes false boundary
// violations, empty-page lockups, and broken in-page interactions.
const APP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// Confinement scope:
//  • 'exact' — pin to one URL (origin+path+query); the opt-in strict URL lock.
//  • 'site'  — pin to the target host, its subdomains, and any auth origins; the
//              always-on default that keeps exploration from wandering off-site.
export type UrlLockScope = 'exact' | 'site';

export interface UrlLockOptions {
  scope?: UrlLockScope;
  authOrigins?: readonly string[]; // 'site' scope only — extra allowed hosts (SSO).
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
  private readonly lockKey: string | null;
  private readonly scope: UrlLockScope;
  /** 'site' scope: pre-canonicalized allowed hosts (target + auth origins). */
  private readonly allowedHosts: string[];

  constructor(
    private readonly lockedUrl: string,
    private readonly telemetry: TelemetryEmitter,
    private readonly options: UrlLockOptions = {},
  ) {
    this.scope = options.scope ?? 'exact';
    this.lockKey = StrictUrlLockGuard.confinementKey(this.lockedUrl);
    this.allowedHosts =
      this.scope === 'site'
        ? [this.lockedUrl, ...(options.authOrigins ?? [])].map(canonicalHost).filter(Boolean)
        : [];
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

  /** True when the main frame may navigate to `url` under the active scope. */
  private nodeAllows(url: string): boolean {
    if (this.scope === 'site') {
      return isWithinTargetSite(url, this.lockedUrl, this.options.authOrigins ?? []);
    }
    const key = StrictUrlLockGuard.confinementKey(url);
    // Non-http(s) target, or a lock that was itself non-http(s) → browser internal.
    return key === null || this.lockKey === null || key === this.lockKey;
  }

  /**
   * Install both layers. MUST be called before the first page.goto so the init
   * script is present for the initial document and every subsequent frame, and
   * the route interceptor is armed for the very first navigation.
   */
  public async install(page: Page): Promise<void> {
    await this.installClientSandbox(page);
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

      if (this.nodeAllows(request.url())) {
        await this.allow(route);
        return;
      }

      // Genuine off-boundary http(s) main-frame navigation — abort pre-commit.
      await this.abort(route);
      this.telemetry.emit('ACTION', {
        actionExecuted: this.scope === 'site' ? 'off-site-nav-blocked' : 'strict-url-lock-blocked',
        url: request.url(),
        message:
          this.scope === 'site'
            ? ` Off-site navigation blocked: ${request.url()} leaves the app under test (${this.lockedUrl}).`
            : ` Strict URL Lock: blocked navigation to ${request.url()} (locked to ${this.lockedUrl}).`,
      });
    };

    await page.route('**/*', handler);
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
  private async installClientSandbox(page: Page): Promise<void> {
    await page.addInitScript(
      (cfg: { scope: UrlLockScope; lockedUrl: string; allowedHosts: string[] }) => {
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
      },
      { scope: this.scope, lockedUrl: this.lockedUrl, allowedHosts: this.allowedHosts },
    );
  }
}

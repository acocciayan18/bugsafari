import type { Page, Route, Request } from 'playwright';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';

// Only real application navigations are subject to confinement. Every other
// scheme is a browser-internal / non-navigational transition (blank frames,
// inline data, script execution, downloads, mail/tel handlers, devtools, etc.)
// and MUST be allowed through untouched — blocking them causes false boundary
// violations, empty-page lockups, and broken in-page interactions.
const APP_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Proactive Strict Page Boundary Lock. Installed on the page BEFORE the initial
 * navigation, it PREVENTS the main frame from leaving the locked application URL
 * rather than reactively correcting drift after it commits.
 *
 * Confinement is scoped precisely to genuine application navigation: only
 * http/https main-frame document loads whose origin, path, or query differ from
 * the lock are blocked. Browser-managed schemes (about:blank, about:, data:,
 * blob:, javascript:, chrome:, mailto:, tel:, file:, ws: …) and pure in-page
 * fragment (hash) changes are treated as internal transitions and pass through,
 * so recovery mechanisms and blank-frame lifecycles are never disrupted.
 *
 * Two cooperating layers:
 *  1. Playwright route interceptor — aborts off-boundary http/https main-frame
 *     document navigations before they commit; everything else falls through.
 *  2. addInitScript client sandbox — neutralizes client-driven location changes
 *     the network layer can't observe (location.assign/replace, history
 *     push/replaceState, anchor/form navigations), applying the identical
 *     scheme + origin/path/query test so it never fights the browser.
 */
export class StrictUrlLockGuard {
  /** Canonical http/https confinement key for the lock, or null if unparseable. */
  private readonly lockKey: string | null;

  constructor(
    private readonly lockedUrl: string,
    private readonly telemetry: TelemetryEmitter,
  ) {
    this.lockKey = StrictUrlLockGuard.confinementKey(this.lockedUrl);
  }

  /**
   * Node-side confinement key, mirrored exactly by the injected browser script.
   * Returns null for non-http(s) URLs (not subject to confinement). Hash is
   * intentionally excluded — a fragment change is an in-page transition, not a
   * navigation away from the app. A lone trailing slash on the path is tolerated.
   */
  private static confinementKey(raw: string, base?: string): string | null {
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
    const lockKey = this.lockKey;
    const mainFrame = page.mainFrame();

    const handler = async (route: Route, request: Request): Promise<void> => {
      // Only a main-frame *document* navigation can leave the locked page. Let
      // everything else (assets, xhr/fetch, sub-frames) through untouched. This
      // guard is registered first, so it runs LAST in Playwright's reverse
      // handler order — any handler that wanted the request (e.g. NetworkSaboteur)
      // has already taken it, so continue() is the unambiguous terminal action.
      if (!request.isNavigationRequest() || request.frame() !== mainFrame) {
        await this.allow(route);
        return;
      }

      const requestKey = StrictUrlLockGuard.confinementKey(request.url());

      // Non-http(s) navigation (about:, data:, blob:, chrome:, …) → browser
      // internal; allow. Also allow if the lock itself was non-http(s).
      if (requestKey === null || lockKey === null) {
        await this.allow(route);
        return;
      }

      if (requestKey === lockKey) {
        await this.allow(route); // in-lock navigation (initial load / reload / fragment)
        return;
      }

      // Genuine off-boundary http(s) main-frame navigation — abort pre-commit.
      await this.abort(route);
      this.telemetry.emit('ACTION', {
        actionExecuted: 'strict-url-lock-blocked',
        url: request.url(),
        message: `🔒 Strict URL Lock: blocked navigation to ${request.url()} (locked to ${this.lockedUrl}).`,
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
    await page.addInitScript((lockedUrlRaw: string) => {
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

      const lockKey = keyOf(lockedUrlRaw);
      if (lockKey === null) {
        return; // lock isn't an http(s) app URL — nothing to confine.
      }

      // True only for a genuine http(s) navigation that leaves the locked app
      // URL. Browser-internal schemes (javascript:, data:, about:, blob:, …),
      // fragment-only changes, and unresolvable targets all return false so they
      // proceed normally. `base` defends against empty/about:blank contexts.
      const leavesLock = (target: string): boolean => {
        const base = window.location.href;
        const targetKey = keyOf(target, base);
        if (targetKey === null) {
          return false;
        }
        return targetKey !== lockKey;
      };

      // 1. location.assign / location.replace — swallow off-lock app targets.
      (['assign', 'replace'] as const).forEach((name) => {
        try {
          const original = window.location[name].bind(window.location);
          Object.defineProperty(window.location, name, {
            configurable: true,
            writable: true,
            value: (url: string | URL) => {
              if (leavesLock(String(url))) return; // blocked
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
            if (url != null && leavesLock(String(url))) return; // blocked
            original(data, unused, url ?? null);
          } as History[typeof name];
        } catch {
          // history methods non-writable in some contexts; best-effort.
        }
      });

      // 3. Anchor clicks (capture phase) — cancel navigations that leave the lock.
      //    javascript:/mailto:/tel:/#fragment hrefs return false from leavesLock
      //    and are never cancelled, so in-page behavior is preserved.
      document.addEventListener(
        'click',
        (event: MouseEvent) => {
          const target = event.target as Element | null;
          const anchor = target && target.closest ? target.closest('a') : null;
          if (anchor && anchor.href && leavesLock(anchor.href)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true,
      );

      // 4. Form submissions (capture phase) — cancel submits that leave the lock.
      document.addEventListener(
        'submit',
        (event: Event) => {
          const form = event.target as HTMLFormElement | null;
          if (!form) return;
          const action = form.getAttribute('action') ?? window.location.href;
          if (leavesLock(action)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true,
      );
    }, this.lockedUrl);
  }
}

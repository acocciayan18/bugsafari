import type { Page } from 'playwright';
import { wait } from './types.js';
import type { StateRestorerDeps } from './types.js';
import { PageHealthGuard } from './PageHealthGuard.js';

/**
 * SPA-friendly navigation, traversal verification, and state-recovery logic.
 * Owns the cheap static lookahead probe, post-click traversal verification, and
 * the three-rung restoration ladder (history → deep-link → hard reload) used for
 * both backtracking and local parent restoration after an unstable edge.
 */
export class StateRestorer {
  constructor(private readonly deps: StateRestorerDeps) {}

  /**
   * Cheap static lookahead probe. For a candidate selector, resolve its
   * navigation target WITHOUT clicking: anchors → resolved absolute `href`;
   * router-links → `data-route`/`data-href`/`to` resolved against the origin.
   * Returns the absolute URL the element would navigate to (`href`), plus:
   *   - `newTab`  — the anchor opens a separate tab (`target="_blank"`), so a
   *     click can never change the app under test's main page.
   *   - `deadEnd` — the resolved href is a non-navigational scheme
   *     (`mailto:`/`tel:`/`javascript:`), which likewise yields no exploration.
   * `href` is null for plain buttons / JS handlers with no static destination.
   * Never throws — a probe failure yields a neutral result so the engine clicks
   * normally.
   */
  public async probeStaticTarget(
    page: Page,
    selector: string,
  ): Promise<{ href: string | null; newTab: boolean; deadEnd: boolean }> {
    try {
      return await page.evaluate((sel: string) => {
        const neutral = { href: null as string | null, newTab: false, deadEnd: false };
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return neutral;
        const anchor = el.closest('a') as HTMLAnchorElement | null;
        if (anchor && anchor.href) {
          // anchor.href is already resolved to an absolute URL by the browser.
          const newTab = anchor.target === '_blank';
          const scheme = anchor.protocol; // e.g. 'https:', 'mailto:', 'tel:', 'javascript:'
          const deadEnd = scheme !== 'http:' && scheme !== 'https:';
          return { href: anchor.href, newTab, deadEnd };
        }
        const route =
          el.getAttribute('data-route') ??
          el.getAttribute('data-href') ??
          el.getAttribute('to');
        if (route) {
          try {
            return { href: new URL(route, document.baseURI).href, newTab: false, deadEnd: false };
          } catch {
            return neutral;
          }
        }
        return neutral;
      }, selector);
    } catch {
      return { href: null, newTab: false, deadEnd: false };
    }
  }

  /**
   * Post-click traversal verification. Polls the DOM fingerprint for up to
   * `timeoutMs` and succeeds once a NEW state hash (different from the parent)
   * appears — preferring one that holds steady across two consecutive reads
   * ("any new stable hash"), but still accepting a late transition observed
   * just before the deadline. If the hash never diverges from the parent the
   * traversal is a no-op failure. Never throws: a hashing/closed-page error is
   * treated as a failed (unstable) traversal so the caller restores the parent.
   */
  public async verifyTraversal(
    page: Page,
    parentHash: string,
    timeoutMs = 3000,
  ): Promise<{ ok: boolean; childHash: string }> {
    const pollIntervalMs = 300;
    const deadline = Date.now() + timeoutMs;
    let lastDivergent = parentHash;

    while (Date.now() < deadline) {
      if (page.isClosed()) break;
      let hash = parentHash;
      try {
        hash = await this.deps.hashManager.hash(page);
      } catch {
        // Transient hashing failure (mid-navigation) — retry until the deadline.
        await wait(pollIntervalMs);
        continue;
      }

      if (hash !== parentHash) {
        // Stable transition: the same new hash seen twice in a row — accept now.
        if (hash === lastDivergent) {
          return { ok: true, childHash: hash };
        }
        lastDivergent = hash;
      }
      await wait(pollIntervalMs);
    }

    // Accept a late/single divergence rather than discarding a real transition;
    // only an unchanged hash counts as a failed (no-op) traversal.
    return lastDivergent !== parentHash
      ? { ok: true, childHash: lastDivergent }
      : { ok: false, childHash: parentHash };
  }

  /** Poll until the DOM fingerprint equals `expectedHash` or the window lapses. */
  public async verifyReachedHash(
    page: Page,
    expectedHash: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const pollIntervalMs = 300;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (page.isClosed()) return false;
      try {
        if ((await this.deps.hashManager.hash(page)) === expectedHash) return true;
      } catch {
        // Mid-navigation hashing failure — retry until the deadline.
      }
      await wait(pollIntervalMs);
    }
    return false;
  }

  /**
   * SPA-friendly state-recovery ladder used for both backtracking and local
   * parent restoration after an unstable edge. Tries, in order:
   *   A) page.goBack()        — preserves client-side state (no full reload)
   *   B) page.goto(targetUrl) — cached deep-link route jump
   *   C) page.goto(origin)    — hard root reload (last resort)
   * Strategy A is accepted only if it verifiably lands on `targetHash`; B/C are
   * accepted on a successful load (SPA fingerprint drift tolerated). Returns
   * true if any rung completed without throwing.
   */
  public async restoreToState(
    page: Page,
    targetHash: string,
    targetUrl: string,
  ): Promise<boolean> {
    // Sanitize the deep-link target: page.goto('about:blank') SUCCEEDS silently,
    // so a missing / non-http(s) / off-origin target would "restore" straight to
    // a blank page. Fall back to the app origin for any such target.
    const safeTargetUrl = this.isRestorableUrl(targetUrl)
      ? targetUrl
      : this.deps.getTargetOrigin();

    // Strategy A — history navigation (preserves in-memory client state).
    // Uses waitUntil:'commit' (the most permissive load state) and verifies by
    // hash rather than by goBack's return value: a same-document SPA history
    // entry (pushState) resolves null and never fires domcontentloaded, yet is
    // still a successful back — only the restored DOM fingerprint proves it.
    // Skipped entirely for an origin re-seed (empty targetHash): there is no
    // history state to verify against, and goBack would walk into the pre-origin
    // about:blank entry — a visible blank frame — before Strategy B recovers.
    if (targetHash) {
      try {
        await page.goBack({ waitUntil: 'commit', timeout: 5000 });
        // goBack can walk into the pre-origin about:blank entry (or off-origin). Don't
        // poll a dead/blank context for 3s — bail to the deep-link rung immediately so
        // no blank frame is ever streamed.
        const landedInvalid =
          PageHealthGuard.isInvalidContext(page) || this.landedOffOrigin(page);
        if (!landedInvalid && (await this.verifyReachedHash(page, targetHash, 3000))) {
          console.log('[StateRestorer] restore strategy A (history) succeeded');
          this.deps.telemetry.emitSystemStatus('Restored via history navigation.');
          this.recordRestoreTrace(targetUrl, 'history-back');
          return true;
        }
      } catch (err) {
        console.warn(
          '[StateRestorer] restore strategy A (history) failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Strategy B — deep-link route jump to the cached parent URL.
    try {
      await page.goto(safeTargetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log('[StateRestorer] restore strategy B (deep-link) succeeded');
      this.deps.telemetry.emitSystemStatus('Restored via deep-link jump.');
      this.recordRestoreTrace(safeTargetUrl, 'deep-link');
      return true;
    } catch (err) {
      console.warn(
        '[StateRestorer] restore strategy B (deep-link) failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Strategy C — hard root reload (last resort).
    try {
      const rootUrl = this.deps.getTargetOrigin() ?? targetUrl;
      await page.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log('[StateRestorer] restore strategy C (root reload) succeeded');
      this.deps.telemetry.emitSystemStatus('Restored via hard root reload.');
      this.recordRestoreTrace(rootUrl, 'root-reload');
      return true;
    } catch (err) {
      console.error(
        '[StateRestorer] restore strategy C (root reload) failed:',
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * True when the current page URL is on a different origin than the app under
   * test (or is unparseable). Mirrors routeTrasher's assertWithinOrigin so a
   * history hop that walks off the application is never accepted as a restore.
   */
  private landedOffOrigin(page: Page): boolean {
    try {
      return new URL(page.url()).origin !== new URL(this.deps.getTargetOrigin()).origin;
    } catch {
      return true;
    }
  }

  /**
   * True when `url` is a real, same-origin http(s) page we can safely goto for a
   * restore. Rejects empty / about:blank / non-http(s) / off-origin targets so we
   * never deep-link "restore" onto a blank page.
   */
  private isRestorableUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return parsed.origin === new URL(this.deps.getTargetOrigin()).origin;
    } catch {
      return false;
    }
  }

  /** Record the recovery navigation in the reproduction playbook. */
  private recordRestoreTrace(url: string, strategy: string): void {
    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: url,
        action: `restore-${strategy}`,
      },
      { actionType: 'NAVIGATE', humanIdentifier: `restore via ${strategy}`, url },
    );
  }
}

import type { Page } from 'playwright';
import { wait } from './types.js';
import type { StateRestorerDeps } from './types.js';

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
   * Returns the absolute URL the element would navigate to, or null if it has
   * no statically-knowable destination (plain buttons / JS handlers). Never
   * throws — a probe failure simply yields null so the engine clicks normally.
   */
  public async probeStaticTarget(page: Page, selector: string): Promise<string | null> {
    try {
      return await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const anchor = el.closest('a') as HTMLAnchorElement | null;
        if (anchor && anchor.href) {
          // anchor.href is already resolved to an absolute URL by the browser.
          return anchor.href;
        }
        const route =
          el.getAttribute('data-route') ??
          el.getAttribute('data-href') ??
          el.getAttribute('to');
        if (route) {
          try {
            return new URL(route, document.baseURI).href;
          } catch {
            return null;
          }
        }
        return null;
      }, selector);
    } catch {
      return null;
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
    // Strategy A — history navigation (preserves in-memory client state).
    // Uses waitUntil:'commit' (the most permissive load state) and verifies by
    // hash rather than by goBack's return value: a same-document SPA history
    // entry (pushState) resolves null and never fires domcontentloaded, yet is
    // still a successful back — only the restored DOM fingerprint proves it.
    try {
      await page.goBack({ waitUntil: 'commit', timeout: 5000 });
      if (await this.verifyReachedHash(page, targetHash, 3000)) {
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

    // Strategy B — deep-link route jump to the cached parent URL.
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log('[StateRestorer] restore strategy B (deep-link) succeeded');
      this.deps.telemetry.emitSystemStatus('Restored via deep-link jump.');
      this.recordRestoreTrace(targetUrl, 'deep-link');
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

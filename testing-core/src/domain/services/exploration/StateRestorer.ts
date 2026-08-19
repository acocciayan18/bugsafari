import type { Page } from 'playwright';
import { wait } from './types.js';
import { shouldExitNoOp } from './pacing.js';
import type { StateRestorerDeps } from './types.js';
import { PageHealthGuard } from './PageHealthGuard.js';
import type { NavigationStep } from '../DIrectedPathFinder.js';
import {
  resolveElementLabel,
  elementNoun,
  genericElementLabel,
  type ElementLabelSource,
} from '../forensics/narration.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[StateRestorer]');

// Bound on the client state carried across a fallback restore.
const MAX_RESTORED_STORAGE_KEYS = 32;

/** localStorage + sessionStorage carried across a document-load restore. */
interface ClientStorageSnapshot {
  local: Record<string, string>;
  session: Record<string, string>;
}

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
    hardCapMs = 3000,
  ): Promise<{ ok: boolean; childHash: string; childStructure: string }> {
    const pollIntervalMs = 200;
    const minObserveMs = 600; // never declare no-op before a real transition could begin
    const quietMs = 350; // network-quiet duration required to call an unchanged DOM a no-op
    const noOpCeilingMs = 1800; // hard no-op cap for pages that never go network-quiet (ads/long-poll)
    const deadline = Date.now() + hardCapMs;
    const start = Date.now();
    let lastDivergent = parentHash;
    // Structure sub-hash of the accepted child — surfaced so the caller can gate
    // the novelty reward on a NEW shell rather than the volatile combined hash.
    let lastDivergentStructure = '';

    // Adaptive pacing (D2/D3): track network activity so a no-op click bails as
    // soon as the page is idle instead of polling the whole budget, while a slow
    // backend-driven transition still holds the window open until the hard cap.
    let inFlight = 0;
    let lastActivityTs = Date.now();
    const onRequest = (): void => { inFlight += 1; lastActivityTs = Date.now(); };
    const onSettled = (): void => { inFlight = Math.max(0, inFlight - 1); lastActivityTs = Date.now(); };
    const onResponse = (): void => { lastActivityTs = Date.now(); };
    page.on('request', onRequest);
    page.on('requestfinished', onSettled);
    page.on('requestfailed', onSettled);
    page.on('response', onResponse);

    try {
      while (Date.now() < deadline) {
        if (page.isClosed()) break;
        let hash = parentHash;
        let structure = '';
        try {
          // Compound (combined + structure) in one pass; combined still drives
          // identity, structure feeds structure-gated novelty upstream.
          const compound = await this.deps.hashManager.hashCompound(page);
          hash = compound.combined;
          structure = compound.structure;
        } catch {
          // Transient hashing failure (mid-navigation) — retry until the deadline.
          await wait(pollIntervalMs);
          continue;
        }

        if (hash !== parentHash) {
          // Stable transition: the same new hash seen twice in a row — accept now.
          if (hash === lastDivergent) {
            return { ok: true, childHash: hash, childStructure: structure };
          }
          lastDivergent = hash;
          lastDivergentStructure = structure;
        } else if (
          lastDivergent === parentHash &&
          shouldExitNoOp({
            elapsedMs: Date.now() - start,
            minObserveMs,
            inFlightRequests: inFlight,
            msSinceLastActivity: Date.now() - lastActivityTs,
            quietMs,
            noOpCeilingMs,
          })
        ) {
          // Unchanged DOM + idle network past the observation floor → no-op. Stop
          // early rather than burning the full budget re-hashing a static page.
          break;
        }
        await wait(pollIntervalMs);
      }
    } finally {
      page.off('request', onRequest);
      page.off('requestfinished', onSettled);
      page.off('requestfailed', onSettled);
      page.off('response', onResponse);
    }

    // Accept a late/single divergence rather than discarding a real transition;
    // only an unchanged hash counts as a failed (no-op) traversal.
    return lastDivergent !== parentHash
      ? { ok: true, childHash: lastDivergent, childStructure: lastDivergentStructure }
      : { ok: false, childHash: parentHash, childStructure: '' };
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
   * Replay a BFS-planned action path hop by hop: click each selector, then
   * verify the DOM fingerprint reached that hop's expected child hash. Every
   * verified hop is recorded in the reproduction playbook, so a replayed route
   * is fully reproducible. Returns false on the first failed click or hash
   * mismatch — the caller replans via the restore ladder. Never throws.
   */
  public async replayPath(page: Page, steps: NavigationStep[]): Promise<boolean> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // Name the hop by the control it actually clicks so the playbook reads
      // `Click the "Settings" link`, never the internal `path replay N/M` jargon.
      const control = await this.resolveReplayControl(page, step.selector);
      // Trace BEFORE clicking (matches ActionExecutor): if the replayed click
      // crashes the app, the causal action must already be in the breadcrumbs.
      this.deps.recordActionTrace(
        { timestamp: new Date().toISOString(), selector: step.selector, action: 'restore-path-replay' },
        {
          actionType: 'CLICK',
          humanIdentifier: control.label,
          elementKind: control.kind,
          url: page.url(),
        },
      );
      try {
        await page.click(step.selector, { timeout: 3000 });
      } catch (err) {
        obsLog.warn(
          `[StateRestorer] path replay hop ${i + 1}/${steps.length} click failed (${step.selector}):`,
          err instanceof Error ? err.message : String(err),
        );
        return false;
      }
      if (!(await this.verifyReachedHash(page, step.toHash, 3000))) {
        obsLog.warn(
          `[StateRestorer] path replay hop ${i + 1}/${steps.length} landed off-route (expected ${step.toHash.substring(0, 8)}).`,
        );
        return false;
      }
    }
    this.deps.telemetry.emitSystemStatus('Restored via shortest-path replay.');
    return true;
  }

  /**
   * Resolve a replay hop's REAL control name + noun from the live DOM, mirroring how a
   * normal click is named (resolveElementLabel/elementNoun). Returns an undefined label
   * when the control has no specific name (narration then reads the bare noun, e.g.
   * "Click the link") or the element cannot be read — never the "path replay N/M"
   * placeholder that used to leak engine jargon into user-facing playbooks. Never throws.
   */
  private async resolveReplayControl(page: Page, selector: string): Promise<{ label?: string; kind?: string }> {
    try {
      const source = await page.evaluate((sel): (ElementLabelSource & { role?: string; href?: string }) | null => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const attr = (name: string): string | undefined => el.getAttribute(name) || undefined;
        const anchor = el.closest('a') as HTMLAnchorElement | null;
        return {
          accessibleName: attr('aria-label') || attr('title'),
          innerText: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() || undefined,
          ariaLabel: attr('aria-label'),
          placeholder: attr('placeholder'),
          name: attr('name'),
          id: el.id || undefined,
          tagName: el.tagName,
          type: attr('type'),
          role: attr('role'),
          href: anchor?.href,
        };
      }, selector);
      if (!source) return {};
      const resolved = resolveElementLabel(source);
      // Drop a non-identifying tag-noun fallback ("button"/"link") so the step reads the
      // bare noun rather than `the "button" button`; a real name always survives.
      const label = resolved && resolved !== genericElementLabel(source.tagName, source.type) ? resolved : undefined;
      const kind = elementNoun(source.tagName, source.type, { role: source.role, href: source.href });
      return { label, kind };
    } catch {
      return {};
    }
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
    // Fall back to the auth-aware re-entry URL (authenticated landing, not the bare
    // origin login page) so a non-restorable target never boots the session.
    const safeTargetUrl = this.isRestorableUrl(targetUrl)
      ? targetUrl
      : this.deps.getReentryUrl();

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
        const contextInvalid = PageHealthGuard.isInvalidContext(page);
        const offOrigin = this.landedOffOrigin(page);
        const landedInvalid = contextInvalid || offOrigin;
        const hashMatched =
          !landedInvalid && (await this.verifyReachedHash(page, targetHash, 3000));
        if (hashMatched) {
          obsLog.info('[StateRestorer] restore strategy A (history) succeeded');
          this.deps.telemetry.emitSystemStatus('Restored via history navigation.');
          this.recordRestoreTrace(targetUrl, 'history-back');
          return true;
        }
      } catch (err) {
        obsLog.warn(
          '[StateRestorer] restore strategy A (history) failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Rungs B and C are DOCUMENT loads: they reset the SPA's in-memory store, so the
    // cart/wizard/session the run had built up is gone and any multi-step flow becomes
    // reachable only by an uninterrupted lucky streak (audit P3-13). Only rung A
    // preserves client state. Snapshot the storage the app currently holds so the
    // fallback rungs can hand it back instead of restoring to a blank store.
    const clientState = await this.captureClientStorage(page);

    // Strategy B — deep-link route jump to the cached parent URL.
    try {
      await page.goto(safeTargetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.reseedClientStorage(page, clientState);
      obsLog.info('[StateRestorer] restore strategy B (deep-link) succeeded');
      this.deps.telemetry.emitSystemStatus('Restored via deep-link jump.');
      this.recordRestoreTrace(safeTargetUrl, 'deep-link');
      return true;
    } catch (err) {
      obsLog.warn(
        '[StateRestorer] restore strategy B (deep-link) failed:',
        err instanceof Error ? err.message : String(err),
      );
    }

    // Strategy C — hard root reload (last resort).
    try {
      const rootUrl = this.deps.getReentryUrl() || this.deps.getTargetOrigin() || targetUrl;
      await page.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await this.reseedClientStorage(page, clientState);
      obsLog.info('[StateRestorer] restore strategy C (root reload) succeeded');
      this.deps.telemetry.emitSystemStatus('Restored via hard root reload.');
      this.recordRestoreTrace(rootUrl, 'root-reload');
      return true;
    } catch (err) {
      obsLog.error(
        '[StateRestorer] restore strategy C (root reload) failed:',
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Bounded snapshot of the app's client-side storage. Null when there is nothing
   * worth carrying, so an app that keeps no client state pays no extra work.
   */
  private async captureClientStorage(page: Page): Promise<ClientStorageSnapshot | null> {
    const snapshot = await page
      .evaluate((limit: number) => {
        const dump = (store: Storage): Record<string, string> => {
          const out: Record<string, string> = {};
          try {
            for (let i = 0; i < store.length && i < limit; i++) {
              const key = store.key(i);
              if (key === null) continue;
              const value = store.getItem(key);
              if (value !== null && value.length <= 4096) out[key] = value;
            }
          } catch {
            // storage blocked (sandboxed / disabled cookies)
          }
          return out;
        };
        return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
      }, MAX_RESTORED_STORAGE_KEYS)
      .catch(() => null);

    if (!snapshot) return null;
    const hasState = Object.keys(snapshot.local).length > 0 || Object.keys(snapshot.session).length > 0;
    return hasState ? snapshot : null;
  }

  /**
   * Write a captured storage snapshot back and reload, so the app BOOTS with the
   * state rather than reading an empty store on mount. Skipped entirely when there
   * was no state to restore, which is the common case and keeps restores cheap.
   */
  private async reseedClientStorage(page: Page, snapshot: ClientStorageSnapshot | null): Promise<void> {
    if (!snapshot) return;
    try {
      await page.evaluate((state: ClientStorageSnapshot) => {
        try {
          for (const [key, value] of Object.entries(state.local)) window.localStorage.setItem(key, value);
        } catch { /* storage blocked */ }
        try {
          for (const [key, value] of Object.entries(state.session)) window.sessionStorage.setItem(key, value);
        } catch { /* storage blocked */ }
      }, snapshot);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
    } catch {
      // Best-effort: a failed re-seed leaves the ordinary blank-store restore intact.
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

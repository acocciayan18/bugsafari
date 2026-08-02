import type { BrowserContext, Frame, Page, Request, Response } from 'playwright';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import type { StabilityMonitor } from '../telemetry/StabilityMonitor.js';
import { StrictUrlLockGuard, type UrlLockScope } from './StrictUrlLockGuard.js';
import { isWithinTargetSite } from '../../../../../shared/url.js';

export type TabRole = 'primary' | 'secondary';
export type TabVerdict = 'approved' | 'blocked';

// Steps granted to one secondary-tab sub-session (the loop may extend up to 5x, bounded by the wall clock).
const SECONDARY_STEP_BUDGET = 8;
// Wall-clock ceiling for one sub-session — the real bound, since the step budget is extensible.
const SECONDARY_WALL_MS = 45_000;
// Total sub-sessions per run, so a popup-spamming target cannot consume the whole budget.
const SECONDARY_SESSIONS_PER_RUN = 5;
// How long to wait for an app-opened tab after clicking the control that should open it.
const POPUP_WAIT_MS = 5_000;
// window.open popups start at about:blank; wait this long for the real destination before classifying.
const CLASSIFY_NAV_WAIT_MS = 2_000;
const CLICK_TIMEOUT_MS = 5_000;
const SECONDARY_LOAD_TIMEOUT_MS = 10_000;
const RECREATE_NAV_TIMEOUT_MS = 20_000;

export interface TabWindowManagerDeps {
  context: BrowserContext;
  telemetry: TelemetryEmitter;
  stabilityMonitor: StabilityMonitor;
  getTargetUrl(): string;
  getTargetOrigin(): string;
  // Extra approved origins (SSO/OAuth popups). Origins only — the auth config never reaches the engine.
  authOrigins: readonly string[];
  boundaryScope: UrlLockScope;
  // Mirrors the focused page into ExplorationEngine.activePage.
  setActivePage(page: Page | null): void;
  onNavigated(url: string): void;
  onNetworkRequest(resourceType: string): void;
  onDocumentResponse(url: string, status: number): void;
  // Suppresses the A->B->A oscillation oracle across a focus or recovery boundary.
  noteEngineNavigation(): void;
  ensureDomReady(page: Page): Promise<void>;
  // Post-navigation monitors for the primary page (heartbeat + console tab).
  attachAfterNavigation(page: Page): Promise<void>;
  disposeAfterNavigation(): void;
  // Bounded sub-session driver, injected so this class never imports ExplorationLoop.
  driveSecondary(page: Page, budget: number, deadlineMs: number): Promise<void>;
}

/**
 * Single owner of every Page in a run: creation, classification, listener wiring,
 * focus, and closure.
 *
 * One tab is focused at a time. The primary tab (the launch page) stays the home
 * state for the whole run; an approved same-origin tab the target opens can take
 * focus for a bounded sub-session and is then closed, returning focus to the
 * primary. Unapproved external tabs are closed before load with nothing attached,
 * so a third-party page can never emit a finding, pollute the console feed, or
 * survive as an orphan.
 *
 * Every listener is a per-page closure returned as a disposer, so no handler
 * outlives the page it observes and no page's events can be attributed to another.
 */
export class TabWindowManager {
  private primaryPage: Page | null = null;
  private focusedPage: Page | null = null;
  private readonly disposers = new Map<Page, () => void>();
  private readonly wired = new WeakSet<Page>();
  // Armed immediately BEFORE context.newPage(); Playwright fires 'page' before that promise resolves.
  private pendingEngineOpen = 0;
  // Single-slot resolver for a tab we deliberately provoked; avoids a second waitForEvent consumer.
  private awaitingTab: ((tab: Page | null) => void) | null = null;
  private secondarySessions = 0;
  private secondaryDepth = 0;
  private onContextPageRef: ((tab: Page) => void) | null = null;

  constructor(private readonly deps: TabWindowManagerDeps) {}

  /** Adopt the launch page as primary, wire it, focus it, and start watching the context for new tabs. */
  public async adoptPrimary(page: Page): Promise<void> {
    this.primaryPage = page;
    this.disposers.set(page, await this.wire(page, 'primary'));
    const handler = (tab: Page): void => { void this.handleNewTab(tab); };
    this.onContextPageRef = handler;
    this.deps.context.on('page', handler);
    await this.focus(page);
  }

  public focused(): Page | null {
    return this.focusedPage;
  }

  /**
   * Approve only the app under test and its configured auth origins.
   *
   * Fails CLOSED, deliberately asymmetric to ExplorationLoop.leavesTargetOrigin,
   * which fails open: an href is a click handed to the browser, but a tab is a
   * live resource we own, and an unclassifiable one is a monitoring liability.
   */
  public classify(url: string): TabVerdict {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'blocked';
      // Approve the target site (host + subdomains) and configured auth origins.
      return isWithinTargetSite(url, this.deps.getTargetOrigin(), this.deps.authOrigins)
        ? 'approved'
        : 'blocked';
    } catch {
      return 'blocked';
    }
  }

  /**
   * A boundary lock (exact or sub-tree) pins the run inside the target boundary, and
   * a secondary tab carries no boundary guard — so any lock but 'site' forbids it.
   */
  public canExploreSecondary(): boolean {
    return (
      this.deps.boundaryScope === 'site' &&
      this.secondaryDepth === 0 &&
      this.secondarySessions < SECONDARY_SESSIONS_PER_RUN
    );
  }

  /**
   * Click a control expected to open a tab, and if an approved one appears drive it
   * in a bounded sub-session, then close it and return focus to the primary.
   * Returns false when no tab appeared, so the caller keeps its existing skip path.
   */
  public async exploreViaControl(page: Page, selector: string): Promise<boolean> {
    const tab = await this.openViaClick(page, selector);
    if (!tab) return false;

    this.secondarySessions += 1;
    this.secondaryDepth += 1;
    try {
      await this.focus(tab);
      this.disposers.set(tab, await this.wire(tab, 'secondary'));
      await tab.waitForLoadState('domcontentloaded', { timeout: SECONDARY_LOAD_TIMEOUT_MS }).catch(() => undefined);
      await this.deps.ensureDomReady(tab);
      await this.deps.driveSecondary(tab, SECONDARY_STEP_BUDGET, Date.now() + SECONDARY_WALL_MS);
    } finally {
      // Unconditional: a stop or throw mid-session must still leave the primary focused,
      // or teardown would close the popup and strand the real page.
      this.secondaryDepth -= 1;
      await this.closeTab(tab);
      await this.releaseFocus();
    }
    return true;
  }

  /** Deepest recovery rung: replace the focused page with a fresh, fully re-wired one on the target. */
  public async recreateFocused(): Promise<Page | null> {
    const dying = this.focusedPage;
    if (!dying) return null;
    this.deps.noteEngineNavigation();

    try {
      const targetUrl = this.deps.getTargetUrl();
      this.deps.telemetry.stopFrameCaptureLoop();
      this.deps.disposeAfterNavigation();
      await this.closeTab(dying);

      this.pendingEngineOpen += 1;
      let fresh: Page;
      try {
        fresh = await this.deps.context.newPage();
      } catch (err) {
        this.pendingEngineOpen = Math.max(0, this.pendingEngineOpen - 1);
        throw err;
      }

      if (dying === this.primaryPage) this.primaryPage = fresh;
      // Reinstall the boundary guard on the fresh primary so confinement survives
      // recreation, under whichever scope the run resolved (exact/sub-tree/site).
      const guard = new StrictUrlLockGuard(targetUrl, this.deps.telemetry, {
        scope: this.deps.boundaryScope,
        authOrigins: this.deps.authOrigins,
      });
      await guard.install(fresh);
      this.disposers.set(fresh, await this.wire(fresh, 'primary'));
      await this.focus(fresh);
      await fresh.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: RECREATE_NAV_TIMEOUT_MS });
      this.deps.onNavigated(fresh.url());
      await this.deps.ensureDomReady(fresh);
      await this.deps.attachAfterNavigation(fresh);
      return fresh;
    } catch (err) {
      console.error('[TabWindowManager] Page recreation failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** Stop watching the context and reclaim every non-primary tab; the primary is closed by the browser engine. */
  public async dispose(): Promise<void> {
    if (this.onContextPageRef) {
      this.deps.context.off('page', this.onContextPageRef);
      this.onContextPageRef = null;
    }
    for (const page of Array.from(this.disposers.keys())) {
      if (page === this.primaryPage) {
        this.disposers.get(page)?.();
        this.disposers.delete(page);
        continue;
      }
      await this.closeTab(page);
    }
    this.focusedPage = null;
    this.primaryPage = null;
  }

  // ── New-tab intake ──────────────────────────────────────────────────────────

  private async handleNewTab(tab: Page): Promise<void> {
    // Our own recovery page — never classified, never closed.
    if (this.pendingEngineOpen > 0) {
      this.pendingEngineOpen -= 1;
      return;
    }

    // Captured before the await so a later arming can't steal this tab.
    const waiter = this.awaitingTab;
    const url = await this.resolveTabUrl(tab);

    if (this.classify(url) === 'blocked') {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'external-tab-blocked',
        url,
        message: `Blocked an external tab opened by the target (${url || 'about:blank'}) — closed before load.`,
      });
      await this.closeTab(tab);
      waiter?.(null);
      return;
    }

    if (waiter) {
      waiter(tab);
      return;
    }

    // Unsolicited approved tab: monitor it for faults but never drive it; reclaimed at dispose().
    this.disposers.set(tab, await this.wire(tab, 'secondary'));
    this.deps.telemetry.emitMilestone(`Monitoring app-opened tab: ${url || 'about:blank'}`);
  }

  /**
   * A target="_blank" tab knows its URL at creation, but a window.open popup starts
   * at about:blank and navigates after. Wait for that first navigation so the
   * destination is classifiable — nothing is attached while we wait, so an
   * unapproved popup still dies before its document finishes loading.
   */
  private async resolveTabUrl(tab: Page): Promise<string> {
    const immediate = tab.url();
    if (immediate && !immediate.startsWith('about:')) return immediate;
    await tab.waitForEvent('framenavigated', { timeout: CLASSIFY_NAV_WAIT_MS }).catch(() => undefined);
    return tab.url();
  }

  private async openViaClick(page: Page, selector: string): Promise<Page | null> {
    let settle: (tab: Page | null) => void = () => undefined;
    const opened = new Promise<Page | null>((resolve) => { settle = resolve; });
    const finish = (tab: Page | null): void => {
      if (this.awaitingTab !== finish) return;
      this.awaitingTab = null;
      settle(tab);
    };

    this.awaitingTab = finish;
    // Deliberately not unref'd: this deadline is awaited, and it is cleared the moment
    // the tab arrives, so it can never outlive the call it bounds.
    const timer = setTimeout(() => finish(null), POPUP_WAIT_MS);

    try {
      await page.click(selector, { timeout: CLICK_TIMEOUT_MS });
    } catch {
      finish(null);
    }

    const tab = await opened;
    clearTimeout(timer);
    if (!tab) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'secondary-tab-absent',
        selector,
        message: 'Expected a new tab from this control but none was approved or opened.',
      });
    }
    return tab;
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  /**
   * Attach every observer this page needs and return the disposer for the
   * detachable ones. Each handler closes over its own `page` parameter, so no two
   * pages ever share a handler and a stale page can never answer for the live one.
   */
  private async wire(page: Page, role: TabRole): Promise<() => void> {
    const existing = this.disposers.get(page);
    if (this.wired.has(page)) return existing ?? ((): void => undefined);
    this.wired.add(page);

    const onFrameNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame() || page !== this.focusedPage) return;
      const url = page.url();
      if (!url) return;
      this.deps.onNavigated(url);
    };

    const onRequest = (request: Request): void => {
      if (page !== this.focusedPage) return;
      this.deps.onNetworkRequest(request.resourceType());
    };

    // Top-level document navigations only, so the loop can flag an HTTP >=400 route
    // without reading bodies. Guarded — a teardown race must never break navigation.
    const onResponse = (response: Response): void => {
      if (page !== this.focusedPage) return;
      try {
        const request = response.request();
        if (request.resourceType() !== 'document' || !request.isNavigationRequest()) return;
        if (response.frame() !== page.mainFrame()) return;
        this.deps.onDocumentResponse(response.url(), response.status());
      } catch {
        // response already gone — ignore
      }
    };

    const onClose = (): void => {
      this.disposers.delete(page);
      if (page === this.focusedPage) this.focusedPage = null;
    };

    page.on('framenavigated', onFrameNavigated);
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('close', onClose);

    if (role === 'primary') {
      this.deps.stabilityMonitor.attachDialogHandler(page);
      this.deps.stabilityMonitor.attachExceptionMonitoring(page);
      this.deps.stabilityMonitor.attachCrashMonitoring(page);
      // Network monitoring is single-page-scoped by construction: its watchdog timer and
      // pending-request registry are StabilityMonitor instance fields, so attaching it to a
      // second page would clear the primary's infinite-loading watchdog.
      this.deps.stabilityMonitor.attachNetworkMonitoring(page);
    } else {
      // Dialog + exception + crash + console, deliberately without network monitoring.
      await this.deps.stabilityMonitor.attachSecondaryPage(page);
    }

    return () => {
      page.off('framenavigated', onFrameNavigated);
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('close', onClose);
    };
  }

  // ── Focus ───────────────────────────────────────────────────────────────────

  private async focus(page: Page): Promise<void> {
    this.focusedPage = page;
    this.deps.noteEngineNavigation();
    await page.bringToFront().catch(() => undefined);
    this.deps.setActivePage(page);
    // Stop before start: startFrameCaptureLoop assigns its interval without clearing an
    // existing one, so a bare second call would leak a 33 ms timer for the rest of the run.
    this.deps.telemetry.stopFrameCaptureLoop();
    this.deps.telemetry.startFrameCaptureLoop(page);
    // Point the run's URL state at the tab actually being driven; a not-yet-navigated
    // page has no URL worth reporting and would only add a blank hop to the history.
    const url = page.url();
    if (url && !url.startsWith('about:')) this.deps.onNavigated(url);
  }

  private async releaseFocus(): Promise<void> {
    const primary = this.primaryPage;
    if (!primary || primary.isClosed()) {
      this.focusedPage = null;
      this.deps.telemetry.stopFrameCaptureLoop();
      this.deps.setActivePage(null);
      return;
    }
    await this.focus(primary);
  }

  /**
   * Close a tab with nothing armed. removeAllListeners drops the StabilityMonitor and
   * console listeners this class cannot detach individually, so an unload-time pageerror,
   * an in-flight requestfailed, or a renderer teardown can never be reported as a finding.
   */
  private async closeTab(page: Page): Promise<void> {
    this.disposers.get(page)?.();
    this.disposers.delete(page);
    if (page === this.focusedPage) this.focusedPage = null;
    if (page.isClosed()) return;
    page.removeAllListeners();
    await page.close().catch(() => undefined);
  }
}

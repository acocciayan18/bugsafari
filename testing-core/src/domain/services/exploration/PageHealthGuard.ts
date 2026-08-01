import type { Page } from 'playwright';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import { StrictUrlLockGuard } from './StrictUrlLockGuard.js';
import { isWithinTargetSite } from '../../../../../shared/url.js';
import { wait } from './types.js';

/** Outcome of a per-iteration health gate; `page` may be a recreated instance. */
export type PageHealthStatus = 'healthy' | 'recovered' | 'unrecoverable';
export interface PageHealthResult {
  page: Page;
  status: PageHealthStatus;
}

export interface PageHealthGuardDeps {
  telemetry: TelemetryEmitter;
  getTargetUrl(): string;
  getTargetOrigin(): string;
  strictUrlLock: boolean;
  // Extra in-scope hosts (SSO/OAuth origins) never treated as off-site drift.
  authOrigins: readonly string[];
  /**
   * Deepest recovery rung: tear down the dead page and return a fresh, fully
   * re-wired page navigated to the target (strict guard reinstalled if enabled),
   * or null if recreation itself failed.
   */
  recreatePage(): Promise<Page | null>;
  /** Record a recovery navigation in the reproduction playbook (best-effort). */
  recordRecovery(url: string, strategy: string): void;
}

// Let any in-flight navigation settle before we issue a competing one — this is
// what makes strict-lock drift restore safe (it never races a live commit).
const SETTLE_MS = 400;
const NAV_TIMEOUT_MS = 15000;

/**
 * Universal page-health recovery state machine, applied once per exploration
 * iteration in BOTH strict-lock and normal modes.
 *
 *  • Invalid context (about:blank, chrome-error, closed page, failed navigation)
 *    → bounded, progressively-stronger recovery: settle+reload → goto target →
 *    goto origin → recreate page → give up. The escalation rung advances on each
 *    consecutive still-invalid round and resets the moment a valid page is seen,
 *    so a transient blank frame costs one cheap reload while a truly wedged page
 *    still terminates deterministically instead of looping forever.
 *  • Strict lock: on any residual drift off the locked URL (the proactive guard
 *    should prevent it, but recover deterministically if one slips through) it
 *    restores the exact target URL after letting navigation settle.
 *  • Normal mode: a valid page is never touched, so ordinary route/page/subdomain
 *    changes proceed undisturbed — the guard only intervenes on invalid states.
 */
export class PageHealthGuard {
  private consecutiveInvalidRounds = 0;
  private totalRecoveries = 0;
  private driftRestores = 0;

  constructor(
    private readonly deps: PageHealthGuardDeps,
    private readonly maxRecoveries = 10,
  ) {}

  /** Browser-internal / failed-navigation contexts that trap exploration. */
  public static isInvalidContext(page: Page): boolean {
    if (page.isClosed()) return true;
    const url = page.url();
    if (!url) return true;
    const lower = url.toLowerCase();
    return (
      lower === 'about:blank' ||
      lower.startsWith('about:') ||
      lower.startsWith('chrome-error://') ||
      lower.startsWith('chrome://')
    );
  }

  public async ensureHealthy(page: Page): Promise<PageHealthResult> {
    // 1. Invalid context (both modes) → escalating recovery ladder.
    if (PageHealthGuard.isInvalidContext(page)) {
      return this.recoverInvalid(page);
    }

    // Valid page — clear the escalators so future recoveries start cheap again.
    this.consecutiveInvalidRounds = 0;
    this.driftRestores = 0;

    // 2. Strict lock: restore on residual drift off the locked URL (exact).
    if (this.deps.strictUrlLock && this.hasDrifted(page)) {
      return this.restoreDrift(page, false);
    }

    // 3. Always-on site confinement (both modes): a navigation that left the target
    //    site (a third-party host, not a subdomain or auth origin) is restored to
    //    the target, however it was triggered — JS, form submit, server redirect,
    //    meta refresh. The proactive boundary guard should prevent it; this is the
    //    deterministic backstop for anything that slips through.
    if (!isWithinTargetSite(page.url(), this.deps.getTargetUrl(), this.deps.authOrigins)) {
      return this.restoreDrift(page, true);
    }

    // 4. On-target → do not interfere.
    return { page, status: 'healthy' };
  }

  // ── Invalid-context recovery ladder ────────────────────────────────────────

  private async recoverInvalid(page: Page): Promise<PageHealthResult> {
    if (this.totalRecoveries >= this.maxRecoveries) {
      this.deps.telemetry.emitMilestone(
        ` Page recovery abandoned after ${this.totalRecoveries} attempts — invalid context persists.`,
      );
      return { page, status: 'unrecoverable' };
    }
    this.totalRecoveries += 1;
    const rung = this.consecutiveInvalidRounds;
    this.consecutiveInvalidRounds += 1;

    const invalidUrl = page.isClosed() ? '(closed)' : page.url();
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'page-health-invalid',
      url: invalidUrl,
      message: `️ Invalid browser context (${invalidUrl}) — recovery rung ${rung}.`,
    });

    // Under strict lock every recovery targets the locked URL; in normal mode we
    // fall back to the application origin (never an arbitrary drifted route).
    const targetUrl = this.deps.getTargetUrl();
    const origin = this.deps.getTargetOrigin() || targetUrl;
    const primaryUrl = this.deps.strictUrlLock ? targetUrl : origin;

    let recovered: Page | null = page;
    try {
      if (page.isClosed() || rung >= 3) {
        recovered = await this.recreate();
      } else if (rung === 0) {
        await this.settleAndReload(page);
      } else if (rung === 1) {
        await this.navigate(page, primaryUrl, 'goto-target');
      } else {
        await this.navigate(page, origin, 'goto-origin');
      }
    } catch (err) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'page-health-recovery-error',
        message: `Recovery rung ${rung} failed: ${errText(err)}`,
      });
      // If the page died during recovery, escalate straight to recreation.
      if (page.isClosed()) recovered = await this.recreate();
    }

    if (!recovered) {
      return { page, status: 'unrecoverable' };
    }
    if (PageHealthGuard.isInvalidContext(recovered)) {
      // Still invalid — the next iteration re-enters here at a higher rung.
      return { page: recovered, status: 'recovered' };
    }

    this.consecutiveInvalidRounds = 0;
    this.deps.telemetry.emitMilestone(`Recovered to a valid page: ${recovered.url()}`);
    return { page: recovered, status: 'recovered' };
  }

  private async recreate(): Promise<Page | null> {
    this.deps.telemetry.emitMilestone('️ Recreating browser page (deepest recovery rung)...');
    try {
      const fresh = await this.deps.recreatePage();
      if (fresh) this.deps.recordRecovery(fresh.isClosed() ? '(closed)' : fresh.url(), 'recreate-page');
      return fresh;
    } catch (err) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'page-health-recovery-error',
        message: `Page recreation failed: ${errText(err)}`,
      });
      return null;
    }
  }

  private async settleAndReload(page: Page): Promise<void> {
    await wait(SETTLE_MS);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    this.deps.recordRecovery(page.url(), 'reload');
  }

  private async navigate(page: Page, url: string, strategy: string): Promise<void> {
    await wait(SETTLE_MS);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    this.deps.recordRecovery(url, strategy);
  }

  // ── Strict-lock drift restore ───────────────────────────────────────────────

  private hasDrifted(page: Page): boolean {
    const current = StrictUrlLockGuard.confinementKey(page.url());
    const lock = StrictUrlLockGuard.confinementKey(this.deps.getTargetUrl());
    // A null key is a browser-internal / unparseable context (handled by the
    // invalid-state path), not http(s) app drift — never treat it as drift here.
    if (current === null || lock === null) return false;
    return current !== lock;
  }

  private async restoreDrift(page: Page, offSite: boolean): Promise<PageHealthResult> {
    if (this.driftRestores >= this.maxRecoveries) {
      this.deps.telemetry.emitMilestone(
        offSite
          ? ' Off-site restore budget exhausted — ending exploration.'
          : ' Strict URL Lock: drift-restore budget exhausted — ending exploration.',
      );
      return { page, status: 'unrecoverable' };
    }
    this.driftRestores += 1;
    const target = this.deps.getTargetUrl();
    this.deps.telemetry.emit('ACTION', {
      actionExecuted: offSite ? 'off-site-restore' : 'strict-url-lock-restore',
      url: page.url(),
      message: offSite
        ? ` Off-site drift to ${page.url()} — restoring the app under test (${target}).`
        : ` Strict URL Lock: residual drift to ${page.url()} — restoring ${target}.`,
    });

    try {
      await wait(SETTLE_MS); // let the drifting navigation settle before correcting
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      this.deps.recordRecovery(target, offSite ? 'off-site-restore' : 'strict-lock-restore');
      return { page, status: 'recovered' };
    } catch (err) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'page-health-recovery-error',
        message: `Drift restore failed: ${errText(err)}`,
      });
      // A failed restore may have left an invalid context — hand off to the ladder.
      if (PageHealthGuard.isInvalidContext(page)) return this.recoverInvalid(page);
      return { page, status: 'recovered' };
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ═══════════════════════════════════════════════════════════════
// regression/ReplaySession.ts — DETERMINISTIC REPLAY CORE
// ═══════════════════════════════════════════════════════════════
// The single implementation of "seed state → load target → replay the recorded
// timeline → decide whether the original fault recurred". Shared by the post-hoc
// regression verifier (Verify Fix on a saved finding) and the in-run reproduction
// probe, so both reach a verdict through identical rules.
//
// The caller owns the context lifecycle and MUST pass a fresh, isolated one: this
// seeds cookies/init scripts that would otherwise leak into a reused session.

import type { BrowserContext, Page, Response } from 'playwright';
import type { ActionStepTrace } from '../../../infrastructure/database/models/SessionModel.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type { ReplayStepStats, StateFingerprint, VerifyFixReason } from '../../../../../shared/types.js';
import { FaultCollector, type SignalBuckets } from './FaultCollector.js';
import { ReplayActionRunner, type ReplayStepStatus } from './ReplayActionRunner.js';
import { ReplayProbes, requiresBodyScan } from './replayProbes.js';
import { isAuthPage } from '../exploration/SessionPreservationGuard.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[ReplaySession]');

// Deterministic settle windows so async faults surface without any randomness.
export const PER_STEP_SETTLE_MS = 400;
export const FINAL_SETTLE_MS = 800;
const NETWORK_SETTLE_MS = 3_000;
const NAV_TIMEOUT_MS = 30_000;
// Retry + backoff + bounded hydration wait for the replay's target load, mirroring the
// exploration engine — so a slow or cold link does not make every finding undecidable.
const NAV_ATTEMPTS = 3;
const NAV_RETRY_BACKOFF_MS = 1_500;
const HYDRATION_SETTLE_MS = 15_000;

export interface ReplaySessionParams {
  targetUrl: string;
  steps: ActionStepTrace[];
  /** Knowledge-base class of the original finding — the match target. */
  bugClass: string;
  /** Coarse fault type of the original finding, for the content-signature pass. */
  faultType: FaultType;
  /** Original finding's message — corroborates same-class matches (empty ⇒ no similarity pass). */
  originalMessage?: string;
  /** Scenario active when the bug was first caught, threaded into classification. */
  scenario?: string;
  /** Client state captured at fault time, restored before the app boots. */
  stateFingerprint?: StateFingerprint;
  /** True ⇒ refuse when the replay lands on a login wall (a stale saved finding). */
  guardLoginWall?: boolean;
  /** Pathname of the request that defined the fault — drives the constraint-bypass oracle. */
  faultEndpoint?: string;
  onProgress?: (phase: 'replaying' | 'validating', stepsReplayed: number, totalSteps: number) => void;
}

export interface ReplaySessionResult {
  /** False ⇒ the replay never reached a decidable state; `reproduced` is meaningless. */
  ok: boolean;
  /** True ⇔ at least one STRONG (corroborated) same-class signal recurred. */
  reproduced: boolean;
  stepsReplayed: number;
  /** Executed/skipped/failed evidence — RESOLVED is only trustworthy when enough ran. */
  stepStats: ReplayStepStats;
  /** Corroborated same-class signals (the reproduction proof). */
  matchedSignals: SignalBuckets['strong'];
  /** Same-class but uncorroborated signals — enough to block RESOLVED, not to prove STILL_ACTIVE. */
  weakSignals: SignalBuckets['weak'];
  /** Different-class faults observed during replay — new findings, not reproduction evidence. */
  otherSignals: SignalBuckets['other'];
  /** URL pathnames the replay actually requested — proves whether the fault trigger ran. */
  seenEndpoints: string[];
  /** True when a page navigation aborted mid-replay — the faulting state may never have loaded. */
  replayIncomplete: boolean;
  /** URL the replay ended on — compared to the recorded fault page to prove the fault location was reached. */
  finalUrl: string;
  error?: string;
  /** Typed failure kind when ok=false — lets the caller explain WHY the replay could not run. */
  failureReason?: VerifyFixReason;
}

const EMPTY_STATS: ReplayStepStats = { total: 0, executed: 0, skipped: 0, failed: 0, finalStepExecuted: false };

// Load the replay target with bounded retries. Earlier attempts wait for domcontentloaded;
// the final attempt falls back to 'commit' + a bounded 'load' wait so a slow-but-reachable
// target still hydrates before the timeline replays, instead of reading as undecidable.
async function navigateWithRetry(page: Page, targetUrl: string): Promise<Response | null> {
  let navError: unknown;
  for (let attempt = 1; attempt <= NAV_ATTEMPTS; attempt++) {
    const waitUntil = attempt < NAV_ATTEMPTS ? 'domcontentloaded' : 'commit';
    try {
      const response = await page.goto(targetUrl, { waitUntil, timeout: NAV_TIMEOUT_MS });
      if (waitUntil === 'commit') {
        await page.waitForLoadState('load', { timeout: HYDRATION_SETTLE_MS }).catch(() => undefined);
      }
      return response;
    } catch (error) {
      navError = error;
      if (attempt >= NAV_ATTEMPTS) break;
      await page.waitForTimeout(NAV_RETRY_BACKOFF_MS * attempt);
    }
  }
  throw navError;
}

/** Replay one finding's timeline in `context` and report whether its fault recurred. */
export async function runReplaySession(
  context: BrowserContext,
  params: ReplaySessionParams,
): Promise<ReplaySessionResult> {
  const { targetUrl, steps, bugClass, faultType } = params;
  const emit = (phase: 'replaying' | 'validating', done: number): void => {
    try {
      params.onProgress?.(phase, done, steps.length);
    } catch {
      // progress delivery is non-critical
    }
  };
  const failed = (error: string, failureReason?: VerifyFixReason): ReplaySessionResult => ({
    ok: false,
    reproduced: false,
    stepsReplayed: 0,
    stepStats: { ...EMPTY_STATS, total: steps.length },
    matchedSignals: [],
    weakSignals: [],
    otherSignals: [],
    seenEndpoints: [],
    replayIncomplete: false,
    finalUrl: '',
    error,
    failureReason,
  });

  await restoreState(context, params.stateFingerprint, targetUrl);

  const page = await context.newPage();
  // A renderer crash (or container OOM-kill) surfaces as thrown step/nav errors that
  // would otherwise read as REPLAY_ERROR; this flag lets us report the real cause.
  let browserCrashed = false;
  page.on('crash', () => {
    browserCrashed = true;
  });
  const collector = new FaultCollector(page, requiresBodyScan(bugClass));
  collector.attach();
  const probes = new ReplayProbes(page, collector, bugClass, faultType, params.faultEndpoint);
  await probes.arm();
  const runner = new ReplayActionRunner(page, targetUrl);

  try {
    let response: Response | null = null;
    try {
      response = await navigateWithRetry(page, targetUrl);
    } catch (navError) {
      const message = navError instanceof Error ? navError.message : String(navError);
      if (browserCrashed) return failed(`Browser crashed while loading target: ${message}`, 'BROWSER_CRASH');
      return failed(`Could not load target: ${message}`, 'TARGET_UNREACHABLE');
    }

    await page.waitForTimeout(PER_STEP_SETTLE_MS);

    if (params.guardLoginWall && (await isBlockedByLogin(page, targetUrl))) {
      return failed('Target requires authentication; the replay never reached the recorded surface.', 'AUTH_WALL');
    }

    // A recorded route that now errors (moved/removed) is not comparable to the original
    // finding. Checked AFTER the auth-wall gate so a 401+login still reads AUTH_WALL.
    if (classifyNavStatus(response ? response.status() : null) === 'ROUTE_CHANGED') {
      const status = response?.status();
      return failed(
        `The recorded route returned HTTP ${status}; it may have moved or been removed, so this result may not be comparable.`,
        'ROUTE_CHANGED',
      );
    }

    const stats: ReplayStepStats = { ...EMPTY_STATS, total: steps.length };
    let stepsReplayed = 0;
    emit('replaying', stepsReplayed);
    for (const step of steps) {
      if (browserCrashed) return failed('The browser process crashed or ran out of memory during replay.', 'BROWSER_CRASH');
      const status = await replayStep(runner, step);
      tally(stats, status);
      if (step === steps[steps.length - 1]) stats.finalStepExecuted = status === 'ok';
      stepsReplayed += 1;
      emit('replaying', stepsReplayed);
      await page.waitForTimeout(PER_STEP_SETTLE_MS);
    }

    // Replay finished; hold for async faults to surface, then classify.
    emit('validating', stepsReplayed);
    await page.waitForTimeout(settleFor(bugClass, faultType));
    // Strip inline script/style source before the content-signature scan: page.content()
    // serializes the whole document, and an app's own `obsLog.error("TypeError…")` literal
    // would otherwise match as a reproduced fault the replay never actually executed.
    const pageContent = stripNonRendered(await page.content().catch(() => ''));
    // Where the replay actually ended — proves whether it stood on the recorded fault page.
    let finalUrl = '';
    try {
      finalUrl = page.url();
    } catch {
      // page torn down; leave empty so the location gate self-disables.
    }
    await probes.drain();
    await collector.drainBodies();
    collector.detach();

    const buckets = collector.evaluate({
      originalBugClass: bugClass,
      originalFaultType: faultType,
      originalMessage: params.originalMessage ?? '',
      scenario: params.scenario,
      pageContent,
    });
    return {
      ok: true,
      reproduced: buckets.strong.length > 0,
      stepsReplayed,
      stepStats: stats,
      matchedSignals: buckets.strong,
      weakSignals: buckets.weak,
      otherSignals: buckets.other,
      seenEndpoints: collector.exercisedEndpoints(),
      replayIncomplete: collector.hadNavigationFailure(),
      finalUrl,
    };
  } catch (error) {
    if (browserCrashed) return failed('The browser process crashed or ran out of memory during replay.', 'BROWSER_CRASH');
    return failed(`Replay error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    probes.detach();
    collector.detach();
    await page.close().catch(() => undefined);
  }
}

/** A persisted blank selector ('N/A') can never resolve — count it skipped without invoking the runner. */
async function replayStep(runner: ReplayActionRunner, step: ActionStepTrace): Promise<ReplayStepStatus> {
  // Navigation steps carry their destination in `url` (not the selector), so they must
  // reach the runner even with a blank selector — it will navigate by URL.
  if (step.actionType !== 'macro' && step.actionType !== 'navigation' && (!step.selector || step.selector === 'N/A')) {
    return 'skipped';
  }
  const outcome = await runner.replay(step);
  if (outcome.status === 'error') {
    obsLog.warn(`[ReplaySession] Step ${step.stepNumber} (${step.actionType}) error: ${outcome.detail}`);
  }
  return outcome.status;
}

function tally(stats: ReplayStepStats, status: ReplayStepStatus): void {
  if (status === 'ok') stats.executed += 1;
  else if (status === 'skipped') stats.skipped += 1;
  else stats.failed += 1;
}

/**
 * A recorded route that now returns a 4xx/5xx no longer serves the surface the finding
 * was captured on, so a clean replay is not comparable to the original. 2xx/3xx (and a
 * null status, e.g. same-document SPA navigation) count as servable.
 */
export function classifyNavStatus(status: number | null): 'ok' | 'ROUTE_CHANGED' {
  return status !== null && status >= 400 ? 'ROUTE_CHANGED' : 'ok';
}

/** Drop script/style bodies + comments so the content scan sees rendered DOM, not source code. */
export function stripNonRendered(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Adaptive validation window: network faults land late, everything else settles fast. */
function settleFor(_bugClass: string, faultType: FaultType): number {
  if (faultType === 'NETWORK') return NETWORK_SETTLE_MS;
  return FINAL_SETTLE_MS;
}

/** Seed cookies + local/session storage from the fingerprint before the app loads. */
async function restoreState(
  context: BrowserContext,
  fingerprint: StateFingerprint | undefined,
  targetUrl: string,
): Promise<void> {
  if (!fingerprint) return;
  try {
    const cookies = fingerprint.cookies ?? [];
    if (cookies.length > 0) {
      await context.addCookies(
        cookies.map((c) => ({
          name: c.name,
          value: c.value,
          ...(c.domain ? { domain: c.domain, path: c.path ?? '/' } : { url: targetUrl }),
        })),
      );
    }
  } catch {
    // Best-effort — a malformed cookie must not abort the replay.
  }

  const local = fingerprint.localStorage ?? {};
  const session = fingerprint.sessionStorage ?? {};
  if (Object.keys(local).length === 0 && Object.keys(session).length === 0) return;
  try {
    await context.addInitScript(
      ({ l, s }: { l: Record<string, string>; s: Record<string, string> }) => {
        try { for (const [k, v] of Object.entries(l)) window.localStorage.setItem(k, v); } catch { /* storage blocked */ }
        try { for (const [k, v] of Object.entries(s)) window.sessionStorage.setItem(k, v); } catch { /* storage blocked */ }
      },
      { l: local, s: session },
    );
  } catch {
    // Best-effort — never block replay on a storage seed failure.
  }
}

/**
 * True when the replay landed on a login wall instead of the recorded surface: a
 * visible password field on a path the finding was not recorded against. The path
 * comparison matters — a finding captured ON the login page is legitimately
 * replayable and must not be refused.
 */
async function isBlockedByLogin(page: Page, recordedUrl: string): Promise<boolean> {
  // A redirect to a recognized auth path (login/signin/sso/…) is a login wall even when
  // no password field is rendered yet — SSO/token gates, async login forms. Only counts
  // when the finding itself was not recorded on an auth page.
  const landedUrl = page.url();
  if (isAuthPage(landedUrl) && !isAuthPage(recordedUrl)) return true;

  const hasPasswordField = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    )
    .catch(() => false);
  if (!hasPasswordField) return false;

  try {
    return new URL(landedUrl).pathname !== new URL(recordedUrl).pathname;
  } catch {
    return false;
  }
}

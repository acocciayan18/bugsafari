// ═══════════════════════════════════════════════════════════════
// regression/ReplaySession.ts — DETERMINISTIC REPLAY CORE
// ═══════════════════════════════════════════════════════════════
// The single implementation of "seed state → load target → replay the recorded
// timeline → decide whether the original fault class recurred". Shared by the
// post-hoc regression verifier (Verify Fix on a saved finding) and the in-run
// reproduction probe, so both reach a verdict through identical rules.
//
// The caller owns the context lifecycle and MUST pass a fresh, isolated one: this
// seeds cookies/init scripts that would otherwise leak into a reused session.

import type { BrowserContext, Page } from 'playwright';
import type { ActionStepTrace } from '../../../infrastructure/database/models/SessionModel.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type { RegressionSignal, StateFingerprint } from '../../../../../shared/types.js';
import { FaultCollector } from './FaultCollector.js';
import { ReplayActionRunner } from './ReplayActionRunner.js';

// Deterministic settle windows so async faults surface without any randomness.
export const PER_STEP_SETTLE_MS = 400;
export const FINAL_SETTLE_MS = 800;
const NAV_TIMEOUT_MS = 30_000;

export interface ReplaySessionParams {
  targetUrl: string;
  steps: ActionStepTrace[];
  /** Knowledge-base class of the original finding — the match target. */
  bugClass: string;
  /** Coarse fault type of the original finding, for the content-signature pass. */
  faultType: FaultType;
  /** Client state captured at fault time, restored before the app boots. */
  stateFingerprint?: StateFingerprint;
  /** True ⇒ refuse when the replay lands on a login wall (a stale saved finding). */
  guardLoginWall?: boolean;
  onProgress?: (phase: 'replaying' | 'validating', stepsReplayed: number, totalSteps: number) => void;
}

export interface ReplaySessionResult {
  /** False ⇒ the replay never reached a decidable state; `reproduced` is meaningless. */
  ok: boolean;
  reproduced: boolean;
  stepsReplayed: number;
  matchedSignals: RegressionSignal[];
  error?: string;
}

/** Replay one finding's timeline in `context` and report whether its fault class recurred. */
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
  const failed = (error: string): ReplaySessionResult => ({
    ok: false,
    reproduced: false,
    stepsReplayed: 0,
    matchedSignals: [],
    error,
  });

  await restoreState(context, params.stateFingerprint, targetUrl);

  const page = await context.newPage();
  const collector = new FaultCollector(page);
  collector.attach();
  const runner = new ReplayActionRunner(page, targetUrl);

  try {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (navError) {
      const message = navError instanceof Error ? navError.message : String(navError);
      return failed(`Could not load target: ${message}`);
    }

    await page.waitForTimeout(PER_STEP_SETTLE_MS);

    if (params.guardLoginWall && (await isBlockedByLogin(page, targetUrl))) {
      return failed('Target requires authentication; the replay never reached the recorded surface.');
    }

    let stepsReplayed = 0;
    emit('replaying', stepsReplayed);
    for (const step of steps) {
      const outcome = await runner.replay(step);
      stepsReplayed += 1;
      if (outcome.status === 'error') {
        console.warn(`[ReplaySession] Step ${step.stepNumber} (${step.actionType}) error: ${outcome.detail}`);
      }
      emit('replaying', stepsReplayed);
      await page.waitForTimeout(PER_STEP_SETTLE_MS);
    }

    // Replay finished; hold for async faults to surface, then classify.
    emit('validating', stepsReplayed);
    await page.waitForTimeout(FINAL_SETTLE_MS);
    const pageContent = await page.content().catch(() => '');
    collector.detach();

    const matchedSignals = collector.evaluate(bugClass, faultType, pageContent);
    return { ok: true, reproduced: matchedSignals.length > 0, stepsReplayed, matchedSignals };
  } catch (error) {
    return failed(`Replay error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    collector.detach();
    await page.close().catch(() => undefined);
  }
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
    return new URL(page.url()).pathname !== new URL(recordedUrl).pathname;
  } catch {
    return false;
  }
}

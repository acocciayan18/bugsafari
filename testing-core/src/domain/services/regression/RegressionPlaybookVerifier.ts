import { chromium, type Browser } from 'playwright';
import { Types, isValidObjectId } from 'mongoose';
import { SessionModel, type ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';
import { classifyFault, normalizeFaultType, type FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type {
  VerifyFixRequest,
  VerifyFixResult,
  VerifyFixReason,
  VerifyFixProgress,
  ReplayStepStats,
} from '../../../../../shared/types.js';
import { runReplaySession, type ReplaySessionResult } from './ReplaySession.js';
import { normalizeRunCode } from '../../../../../shared/runCode.js';
import { isReplayVerifiable } from './replayProbes.js';
import { decideVerdict, confirmResolution, summarize, type VerdictDecision } from './verdict.js';
import type { LoadedFinding } from './types.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[RegressionVerifier]');

const LAUNCH_TIMEOUT_MS = 30_000;
const PREFLIGHT_TIMEOUT_MS = 6_000;
const EMPTY_STATS: ReplayStepStats = { total: 0, executed: 0, skipped: 0, failed: 0, finalStepExecuted: false };

/**
 * Deterministic regression replay. Given a saved finding it launches a FRESH,
 * isolated Playwright session, replays the finding's recorded action timeline in
 * order — with NO autonomous exploration (no scorer/navigator/AutonomousExplorationEngine)
 * — and re-applies the exact knowledge-base validation rules that first reported
 * the bug. Same finding + same target ⇒ same verdict.
 */
export class RegressionPlaybookVerifier {
  /**
   * Replay + validate one finding for one authenticated user.
   * @param request     sessionId + bugId of the finding to re-check.
   * @param userId      verified user id — the session query is scoped to it (least privilege).
   * @param onProgress  optional sink for streamed replay phases (replaying → validating).
   */
  public async verify(
    request: VerifyFixRequest,
    userId: string,
    onProgress?: (progress: VerifyFixProgress) => void,
  ): Promise<VerifyFixResult> {
    const startedAt = Date.now();
    const { sessionId, bugId } = request;
    // Never let a progress-sink failure abort the replay — telemetry is best-effort.
    const emit = (phase: VerifyFixProgress['phase'], stepsReplayed: number, totalSteps: number): void => {
      try {
        onProgress?.({ sessionId, bugId, phase, stepsReplayed, totalSteps });
      } catch {
        /* progress delivery is non-critical */
      }
    };

    // Accept the public RUN- code or a legacy raw ObjectId; loadFinding resolves either.
    if ((!normalizeRunCode(sessionId) && !isValidObjectId(sessionId)) || !bugId) {
      return this.failed(sessionId, bugId, 'UNKNOWN', startedAt, 'Invalid sessionId or bugId.');
    }

    const finding = await this.loadFinding(sessionId, bugId, userId);
    if (!finding) {
      return this.failed(sessionId, bugId, 'UNKNOWN', startedAt, 'Finding not found or access denied.');
    }

    const originalFaultType = normalizeFaultType(finding.bug.type);
    const originalBugClass = this.resolveOriginalBugClass(finding, originalFaultType);

    // Classes replay can never evidence must not burn a browser launch to fabricate RESOLVED.
    if (!isReplayVerifiable(originalBugClass)) {
      return this.inconclusive(
        sessionId,
        bugId,
        originalBugClass,
        startedAt,
        'UNVERIFIABLE_BUG_CLASS',
        `${originalBugClass} cannot be verified by deterministic replay; re-test with a live exploration run.`,
      );
    }

    obsLog.info(
      `[RegressionVerifier] Replaying ${finding.actionSteps.length} step(s) for bug ${bugId} ` +
        `(class=${originalBugClass}, timeline=${finding.timelineSource}) on ${finding.targetUrl}`,
    );

    // Cheap liveness check before spending ~90s of browser nav timeouts on a dead host.
    if (!(await this.isTargetReachable(finding.targetUrl))) {
      return this.failed(
        sessionId,
        bugId,
        originalBugClass,
        startedAt,
        `Could not reach target ${finding.targetUrl} (no response within ${PREFLIGHT_TIMEOUT_MS / 1000}s). Is the app running?`,
        'TARGET_UNREACHABLE',
        { ...EMPTY_STATS, total: finding.actionSteps.length },
        finding.timelineSource,
      );
    }

    let browser: Browser | undefined;
    try {
      browser = await this.launchBrowser();

      const decide = (p: ReplaySessionResult): VerdictDecision =>
        decideVerdict({
          strong: p.matchedSignals,
          weak: p.weakSignals,
          stats: p.stepStats,
          timelineSource: finding.timelineSource,
          faultEndpoint: this.faultEndpoint(finding),
          seenEndpoints: p.seenEndpoints,
          replayIncomplete: p.replayIncomplete,
        });

      const probe = await this.attempt(browser, finding, originalBugClass, originalFaultType, emit);
      if (!probe.ok) {
        return this.failed(
          sessionId,
          bugId,
          originalBugClass,
          startedAt,
          probe.error ?? 'Replay failed.',
          probe.failureReason,
          probe.stepStats,
          finding.timelineSource,
        );
      }

      let decision = decide(probe);
      let evidence = probe;

      // A single clean replay is flaky against a live target (backend data/timing),
      // so a would-be RESOLVED is confirmed with a SECOND independent replay before we
      // call a bug fixed. Reproduction on the retry flips to STILL_ACTIVE; a disagreeing
      // or un-runnable retry means the fix can't be confirmed (UNCONFIRMED_RESOLUTION).
      // Reproduction and inconclusive verdicts are already conservative — no re-run.
      if (decision.verdict === 'RESOLVED') {
        const confirm = await this.attempt(browser, finding, originalBugClass, originalFaultType, emit);
        decision = confirmResolution(confirm.ok ? decide(confirm) : null);
        if (confirm.ok && decision.verdict !== 'RESOLVED') evidence = confirm;
        obsLog.info(`[RegressionVerifier] Confirmation replay for bug ${bugId}: ${decision.verdict}/${decision.reason}`);
      }

      const summary = summarize(decision, originalBugClass, evidence.stepStats);

      obsLog.info(
        `[RegressionVerifier] Verdict for bug ${bugId}: ${decision.verdict}/${decision.reason} ` +
          `(${decision.matchedSignals.length} signal(s), ${evidence.stepStats.executed}/${evidence.stepStats.total} executed)`,
      );

      return {
        ok: true,
        verdict: decision.verdict,
        reason: decision.reason,
        sessionId,
        bugId,
        bugClass: originalBugClass,
        stepsReplayed: evidence.stepsReplayed,
        stepStats: evidence.stepStats,
        matchedSignals: decision.matchedSignals,
        otherSignals: evidence.otherSignals,
        timelineSource: finding.timelineSource,
        summary,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failed(
        sessionId,
        bugId,
        originalBugClass,
        startedAt,
        `Replay error: ${message}`,
        'REPLAY_ERROR',
        { ...EMPTY_STATS, total: finding.actionSteps.length },
        finding.timelineSource,
      );
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  /**
   * One isolated replay attempt: a FRESH context (no cookie/init-script bleed between
   * attempts) replays the finding's timeline and reports whether its fault recurred.
   * The auth-wall guard is ON — a stale authenticated finding replayed against a login
   * page would miss every selector and read RESOLVED, a false negative we refuse.
   */
  private async attempt(
    browser: Browser,
    finding: LoadedFinding,
    bugClass: string,
    faultType: FaultType,
    emit: (phase: 'replaying' | 'validating', done: number, total: number) => void,
  ): Promise<ReplaySessionResult> {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      deviceScaleFactor: 1,
    });
    try {
      return await runReplaySession(context, {
        targetUrl: finding.targetUrl,
        steps: finding.actionSteps,
        bugClass,
        faultType,
        originalMessage: finding.bug.message ?? '',
        scenario: finding.bug.attribution?.scenario,
        stateFingerprint: finding.bug.stateFingerprint,
        guardLoginWall: true,
        faultEndpoint: this.faultEndpoint(finding),
        onProgress: (phase, done, total) => emit(phase, done, total),
      });
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // Resolve a public RUN- code (or a raw ObjectId) to an ownership-scoped selector —
  // the client only ever holds the public code now.
  private resolveSelector(sessionId: string): { runId: string } | { _id: Types.ObjectId } | null {
    const code = normalizeRunCode(sessionId);
    if (code) return { runId: code };
    return isValidObjectId(sessionId) ? { _id: new Types.ObjectId(sessionId) } : null;
  }

  /**
   * Persist a terminal replay verdict onto the finding so it survives a report
   * refresh. Owner-scoped positional update; failure is non-fatal (never fails the
   * verify ack), mirroring the on-demand aiAdvice/insights writes.
   */
  public async persistVerification(sessionId: string, bugId: string, userId: string, result: VerifyFixResult): Promise<void> {
    if (!isValidObjectId(userId)) return;
    const selector = this.resolveSelector(sessionId);
    if (!selector) return;
    try {
      await SessionModel.updateOne(
        { ...selector, userId: new Types.ObjectId(userId), 'forensicTrace.caughtBugs.bugId': bugId },
        { $set: { 'forensicTrace.caughtBugs.$.verification': { ...result, verifiedAt: new Date().toISOString() } } },
      );
    } catch (error) {
      obsLog.error('verify-fix persist failed:', error instanceof Error ? error.message : error);
    }
  }

  /** Load the target URL, recorded timeline, and the specific caught bug — scoped to the user. */
  private async loadFinding(sessionId: string, bugId: string, userId: string): Promise<LoadedFinding | null> {
    if (!isValidObjectId(userId)) return null;

    const selector = this.resolveSelector(sessionId);
    if (!selector) return null;

    const doc = await SessionModel.findOne({
      ...selector,
      userId: new Types.ObjectId(userId),
    })
      .select('targetUrl actionSteps forensicTrace')
      .lean();

    if (!doc) return null;

    const bug = doc.forensicTrace?.caughtBugs?.find((candidate: ICaughtBug) => candidate.bugId === bugId);
    if (!bug) return null;

    // Prefer THIS finding's own minimized, replayable timeline; fall back to the
    // session-global timeline only for legacy records saved before per-finding
    // capture existed. A clean run on the fallback cannot prove the fix (LEGACY_TIMELINE).
    const perFindingSteps = Array.isArray(bug.actionSteps) ? bug.actionSteps : [];
    const usePerFinding = perFindingSteps.length > 0;
    return {
      targetUrl: doc.targetUrl,
      actionSteps: usePerFinding ? perFindingSteps : doc.actionSteps ?? [],
      bug,
      timelineSource: usePerFinding ? 'finding' : 'session',
    };
  }

  /**
   * Pathname of the request that produced the fault, parsed from the finding message —
   * either a full URL ("POST http://host/api/login" → "/api/login") or a method-prefixed
   * relative path ("POST /backend/login.php" → "/backend/login.php"). Empty when the fault
   * has no associated request — the endpoint-exercised gate then does not apply.
   */
  private faultEndpoint(finding: LoadedFinding): string | undefined {
    const message = finding.bug.message ?? '';
    const absolute = message.match(/https?:\/\/[^\s"')]+/i)?.[0];
    if (absolute) {
      try {
        const path = new URL(absolute).pathname;
        if (path !== '/') return path;
      } catch {
        /* fall through to the relative form */
      }
    }
    // Relative form: an HTTP method immediately followed by a rooted path.
    const relative = message.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s"')?#]+)/i)?.[1];
    return relative && relative !== '/' ? relative : undefined;
  }

  /** Prefer the persisted knowledge-base class; otherwise derive it deterministically. */
  private resolveOriginalBugClass(finding: LoadedFinding, faultType: FaultType): string {
    const persisted = finding.bug.attribution?.bugClass;
    if (persisted && persisted.length > 0) return persisted;

    return classifyFault({
      faultType,
      message: finding.bug.message ?? '',
      scenario: finding.bug.attribution?.scenario,
      url: finding.targetUrl,
    }).bugClass;
  }

  private async launchBrowser(): Promise<Browser> {
    return Promise.race([
      chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Browser launch timeout after ${LAUNCH_TIMEOUT_MS}ms`)), LAUNCH_TIMEOUT_MS),
      ),
    ]);
  }

  /** Replay ran but the evidence cannot support RESOLVED — verdict INCONCLUSIVE with a typed reason. */
  private inconclusive(
    sessionId: string,
    bugId: string,
    bugClass: string,
    startedAt: number,
    reason: VerifyFixReason,
    summary: string,
  ): VerifyFixResult {
    obsLog.warn(`[RegressionVerifier] INCONCLUSIVE (${reason}) for bug ${bugId}: ${summary}`);
    return {
      ok: true,
      verdict: 'INCONCLUSIVE',
      reason,
      sessionId,
      bugId,
      bugClass,
      stepsReplayed: 0,
      stepStats: { ...EMPTY_STATS },
      matchedSignals: [],
      otherSignals: [],
      timelineSource: 'finding',
      summary,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * The replay could not run at all — the verdict says nothing about the bug.
   * `stepStats`/`timelineSource` carry the finding's real recorded totals when known,
   * so a nav-fail card shows 0/N (not a misleading 0/0) and the true timeline.
   */
  private failed(
    sessionId: string,
    bugId: string,
    bugClass: string,
    startedAt: number,
    error: string,
    reason: VerifyFixReason = 'REPLAY_ERROR',
    stepStats: ReplayStepStats = { ...EMPTY_STATS },
    timelineSource: VerifyFixResult['timelineSource'] = 'finding',
  ): VerifyFixResult {
    obsLog.warn(`[RegressionVerifier] VERIFICATION_FAILED (${reason}) for bug ${bugId}: ${error}`);
    return {
      ok: false,
      verdict: 'VERIFICATION_FAILED',
      reason,
      sessionId,
      bugId,
      bugClass,
      stepsReplayed: 0,
      stepStats,
      matchedSignals: [],
      otherSignals: [],
      timelineSource,
      summary: `Verification failed: ${error}`,
      durationMs: Date.now() - startedAt,
      error,
    };
  }

  // ANY HTTP response (even 4xx/5xx) = reachable; only a connection/DNS failure or
  // timeout short-circuits. Advisory: catches the "host fully down" case the browser
  // retries can't salvage, not slow-but-up targets (those keep the browser retry budget).
  private async isTargetReachable(url: string): Promise<boolean> {
    try {
      await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
      return true;
    } catch {
      return false;
    }
  }
}

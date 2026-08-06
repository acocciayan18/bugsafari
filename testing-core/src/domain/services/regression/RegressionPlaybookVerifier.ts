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
import { runReplaySession } from './ReplaySession.js';
import { normalizeRunCode } from '../../../../../shared/runCode.js';
import { isReplayVerifiable } from './replayProbes.js';
import { decideVerdict, summarize } from './verdict.js';
import type { LoadedFinding } from './types.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[RegressionVerifier]');

const LAUNCH_TIMEOUT_MS = 30_000;
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

    let browser: Browser | undefined;
    try {
      browser = await this.launchBrowser();
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ignoreHTTPSErrors: true,
        deviceScaleFactor: 1,
      });

      // Auth wall guard is ON: credentials are ephemeral, so a finding from an
      // authenticated run replays against a login page days later. Every step would
      // miss its selector, no fault would surface, and the bug would be declared
      // RESOLVED — a false negative. Refuse to guess instead.
      const probe = await runReplaySession(context, {
        targetUrl: finding.targetUrl,
        steps: finding.actionSteps,
        bugClass: originalBugClass,
        faultType: originalFaultType,
        originalMessage: finding.bug.message ?? '',
        scenario: finding.bug.attribution?.scenario,
        stateFingerprint: finding.bug.stateFingerprint,
        guardLoginWall: true,
        onProgress: (phase, done, total) => emit(phase, done, total),
      });

      if (!probe.ok) {
        return this.failed(
          sessionId,
          bugId,
          originalBugClass,
          startedAt,
          probe.error ?? 'Replay failed.',
          probe.failureReason,
        );
      }

      const decision = decideVerdict({
        strong: probe.matchedSignals,
        weak: probe.weakSignals,
        stats: probe.stepStats,
        timelineSource: finding.timelineSource,
        faultEndpoint: this.faultEndpoint(finding),
        seenEndpoints: probe.seenEndpoints,
      });
      const summary = summarize(decision, originalBugClass, probe.stepStats);

      obsLog.info(
        `[RegressionVerifier] Verdict for bug ${bugId}: ${decision.verdict}/${decision.reason} ` +
          `(${decision.matchedSignals.length} signal(s), ${probe.stepStats.executed}/${probe.stepStats.total} executed)`,
      );

      return {
        ok: true,
        verdict: decision.verdict,
        reason: decision.reason,
        sessionId,
        bugId,
        bugClass: originalBugClass,
        stepsReplayed: probe.stepsReplayed,
        stepStats: probe.stepStats,
        matchedSignals: decision.matchedSignals,
        otherSignals: probe.otherSignals,
        timelineSource: finding.timelineSource,
        summary,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failed(sessionId, bugId, originalBugClass, startedAt, `Replay error: ${message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  /** Load the target URL, recorded timeline, and the specific caught bug — scoped to the user. */
  private async loadFinding(sessionId: string, bugId: string, userId: string): Promise<LoadedFinding | null> {
    if (!isValidObjectId(userId)) return null;

    // Resolve the public RUN- code (or a raw ObjectId) to an ownership-scoped
    // selector — the client only ever holds the public code now.
    const code = normalizeRunCode(sessionId);
    const selector = code
      ? { runId: code }
      : isValidObjectId(sessionId) ? { _id: new Types.ObjectId(sessionId) } : null;
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
   * Pathname of the request that produced the fault, parsed from the finding message
   * (e.g. "HTTP 200 Error: POST http://host/api/login" → "/api/login"). Empty when the
   * fault has no associated request — the endpoint-exercised gate then does not apply.
   */
  private faultEndpoint(finding: LoadedFinding): string | undefined {
    const url = finding.bug.message?.match(/https?:\/\/[^\s"')]+/i)?.[0];
    if (!url) return undefined;
    try {
      const path = new URL(url).pathname;
      return path === '/' ? undefined : path;
    } catch {
      return undefined;
    }
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

  /** The replay could not run at all — the verdict says nothing about the bug. */
  private failed(
    sessionId: string,
    bugId: string,
    bugClass: string,
    startedAt: number,
    error: string,
    reason: VerifyFixReason = 'REPLAY_ERROR',
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
      stepStats: { ...EMPTY_STATS },
      matchedSignals: [],
      otherSignals: [],
      timelineSource: 'finding',
      summary: `Verification failed: ${error}`,
      durationMs: Date.now() - startedAt,
      error,
    };
  }
}

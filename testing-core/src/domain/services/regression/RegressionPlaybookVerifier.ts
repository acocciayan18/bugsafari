import { chromium, type Browser } from 'playwright';
import { Types, isValidObjectId } from 'mongoose';
import { SessionModel, type ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';
import { classifyFault, normalizeFaultType, type FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type {
  VerifyFixRequest,
  VerifyFixResult,
  RegressionVerdict,
  VerifyFixProgress,
} from '../../../../../shared/types.js';
import { runReplaySession } from './ReplaySession.js';
import type { LoadedFinding } from './types.js';

const LAUNCH_TIMEOUT_MS = 30_000;

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

    if (!isValidObjectId(sessionId) || !bugId) {
      return this.inconclusive(sessionId, bugId, 'UNKNOWN', 0, startedAt, 'Invalid sessionId or bugId.');
    }

    const finding = await this.loadFinding(sessionId, bugId, userId);
    if (!finding) {
      return this.inconclusive(sessionId, bugId, 'UNKNOWN', 0, startedAt, 'Finding not found or access denied.');
    }

    const originalFaultType = normalizeFaultType(finding.bug.type);
    const originalBugClass = this.resolveOriginalBugClass(finding, originalFaultType);

    console.log(
      `[RegressionVerifier] Replaying ${finding.actionSteps.length} step(s) for bug ${bugId} ` +
        `(class=${originalBugClass}) on ${finding.targetUrl}`,
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
        stateFingerprint: finding.bug.stateFingerprint,
        guardLoginWall: true,
        onProgress: (phase, done, total) => emit(phase, done, total),
      });

      if (!probe.ok) {
        return this.inconclusive(sessionId, bugId, originalBugClass, probe.stepsReplayed, startedAt, probe.error ?? 'Replay failed.');
      }

      const { matchedSignals, stepsReplayed } = probe;
      const verdict: RegressionVerdict = probe.reproduced ? 'STILL_ACTIVE' : 'RESOLVED';
      const summary =
        verdict === 'STILL_ACTIVE'
          ? `Bug still active: ${originalBugClass} reproduced after replaying ${stepsReplayed} recorded step(s).`
          : `No ${originalBugClass} fault reproduced after replaying ${stepsReplayed} recorded step(s). Defect resolved.`;

      console.log(`[RegressionVerifier] Verdict for bug ${bugId}: ${verdict} (${matchedSignals.length} signal(s))`);

      return {
        ok: true,
        verdict,
        sessionId,
        bugId,
        bugClass: originalBugClass,
        stepsReplayed,
        matchedSignals,
        summary,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.inconclusive(sessionId, bugId, originalBugClass, 0, startedAt, `Replay error: ${message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  /** Load the target URL, recorded timeline, and the specific caught bug — scoped to the user. */
  private async loadFinding(sessionId: string, bugId: string, userId: string): Promise<LoadedFinding | null> {
    if (!isValidObjectId(userId)) return null;

    const doc = await SessionModel.findOne({
      _id: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(userId),
    })
      .select('targetUrl actionSteps forensicTrace')
      .lean();

    if (!doc) return null;

    const bug = doc.forensicTrace?.caughtBugs?.find((candidate: ICaughtBug) => candidate.bugId === bugId);
    if (!bug) return null;

    // Prefer THIS finding's own minimized, replayable timeline; fall back to the
    // session-global timeline only for legacy records saved before per-finding
    // capture existed. Per-finding steps replay just the causally-required actions.
    const perFindingSteps = Array.isArray(bug.actionSteps) ? bug.actionSteps : [];
    return {
      targetUrl: doc.targetUrl,
      actionSteps: perFindingSteps.length > 0 ? perFindingSteps : doc.actionSteps ?? [],
      bug,
    };
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

  private inconclusive(
    sessionId: string,
    bugId: string,
    bugClass: string,
    stepsReplayed: number,
    startedAt: number,
    error: string,
  ): VerifyFixResult {
    console.warn(`[RegressionVerifier] INCONCLUSIVE for bug ${bugId}: ${error}`);
    return {
      ok: false,
      verdict: 'INCONCLUSIVE',
      sessionId,
      bugId,
      bugClass,
      stepsReplayed,
      matchedSignals: [],
      summary: `Verification inconclusive: ${error}`,
      durationMs: Date.now() - startedAt,
      error,
    };
  }
}

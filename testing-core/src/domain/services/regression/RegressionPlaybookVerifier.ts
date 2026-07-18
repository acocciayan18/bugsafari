import { chromium, type Browser, type BrowserContext } from 'playwright';
import { Types, isValidObjectId } from 'mongoose';
import { SessionModel, type ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';
import { classifyFault, type FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import type {
  VerifyFixRequest,
  VerifyFixResult,
  RegressionVerdict,
  VerifyFixProgress,
  StateFingerprint,
} from '../../../../../shared/types.js';
import { FaultCollector } from './FaultCollector.js';
import { ReplayActionRunner } from './ReplayActionRunner.js';
import type { LoadedFinding } from './types.js';

// Deterministic settle windows so async faults surface without any randomness.
const PER_STEP_SETTLE_MS = 400;
const FINAL_SETTLE_MS = 800;
const NAV_TIMEOUT_MS = 30_000;
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

    const originalFaultType = this.normalizeFaultType(finding.bug.type);
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
      const page = await context.newPage();
      // Restore the fault-time client state BEFORE the app boots so cross-page-state
      // faults reproduce (addInitScript/addCookies must precede goto).
      await this.restoreState(context, finding.bug.stateFingerprint, finding.targetUrl);
      const collector = new FaultCollector(page);
      collector.attach();
      const runner = new ReplayActionRunner(page, finding.targetUrl);

      try {
        await page.goto(finding.targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      } catch (navError) {
        const message = navError instanceof Error ? navError.message : String(navError);
        return this.inconclusive(sessionId, bugId, originalBugClass, 0, startedAt, `Could not load target: ${message}`);
      }

      await page.waitForTimeout(PER_STEP_SETTLE_MS);

      const totalSteps = finding.actionSteps.length;
      let stepsReplayed = 0;
      emit('replaying', stepsReplayed, totalSteps);
      for (const step of finding.actionSteps) {
        const outcome = await runner.replay(step);
        stepsReplayed += 1;
        if (outcome.status === 'error') {
          console.warn(`[RegressionVerifier] Step ${step.stepNumber} (${step.actionType}) error: ${outcome.detail}`);
        }
        emit('replaying', stepsReplayed, totalSteps);
        await page.waitForTimeout(PER_STEP_SETTLE_MS);
      }

      // Replay finished; hold for async faults to surface, then classify.
      emit('validating', totalSteps, totalSteps);
      await page.waitForTimeout(FINAL_SETTLE_MS);
      const pageContent = await page.content().catch(() => '');
      collector.detach();

      const matchedSignals = collector.evaluate(originalBugClass, originalFaultType, pageContent);
      const verdict: RegressionVerdict = matchedSignals.length > 0 ? 'STILL_ACTIVE' : 'RESOLVED';
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

  /** Seed cookies + local/session storage from the finding's fingerprint before the app loads. */
  private async restoreState(context: BrowserContext, fingerprint: StateFingerprint | undefined, targetUrl: string): Promise<void> {
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
      // Best-effort — a malformed cookie must not abort verification.
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

  /** Map a persisted fault type string onto the classifier's coarse FaultType. */
  private normalizeFaultType(type: string | undefined): FaultType {
    const upper = (type ?? '').toUpperCase();
    if (upper.includes('NETWORK') || upper.includes('API') || upper.includes('HTTP') || upper.includes('BOUNDARY')) {
      return 'NETWORK';
    }
    if (upper.includes('FREEZE') || upper.includes('STALL') || upper.includes('UI')) return 'FREEZE';
    if (upper.includes('CONSOLE')) return 'CONSOLE';
    return 'EXCEPTION';
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

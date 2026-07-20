// ═══════════════════════════════════════════════════════════════
// verification/ReproductionProbe.ts — IN-RUN REPRODUCTION CONFIRMATION
// ═══════════════════════════════════════════════════════════════
// When a candidate becomes a reported finding, its minimized timeline is replayed
// ONCE to decide whether the fault actually recurs. The verdict feeds
// VerificationCandidate.reproduced, which moves the confidence score ±0.15 and is
// the difference between a one-off flake and a defect worth a developer's time.
//
// The replay runs in a SIDECAR context of the same browser, never on the live page:
// driving the explored page would corrupt the state graph, cluster registry, and
// DOM-hash continuity the navigator depends on. The sidecar inherits the live
// context's storage state, so an authenticated run replays authenticated too.
//
// Fire-and-forget by design: exploration never blocks on a probe. Replays are
// serialized and the queue is bounded, so a fault storm cannot spawn parallel
// headless sessions or grow memory without limit.

import type { Browser, BrowserContext } from 'playwright';
import type { ActionRecord, RegressionSignal, StateFingerprint } from '../../../../../shared/types.js';
import type { FaultType } from '../../../bugs/knowledgeBase/FaultClassifier.js';
import { buildActionSteps } from '../forensics/actionStepMapper.js';
import { runReplaySession } from '../regression/ReplaySession.js';

// Deep queues are worthless here: by the time a stale candidate replays, the app is
// many states away and the verdict says nothing. Shed load instead of lying.
const MAX_QUEUED = 12;
// A replay that has not settled by now is wedged; abandon it so the queue drains.
const PROBE_TIMEOUT_MS = 45_000;

export interface ReproductionRequest {
  bugId: string;
  targetUrl: string;
  /** Minimized, causally-required timeline for this finding. */
  actions: ActionRecord[];
  bugClass: string;
  faultType: FaultType;
  stateFingerprint?: StateFingerprint;
}

export interface ReproductionOutcome {
  bugId: string;
  reproduced: boolean;
  stepsReplayed: number;
  matchedSignals: RegressionSignal[];
}

export type ReproductionSink = (outcome: ReproductionOutcome) => void;

export class ReproductionProbe {
  private readonly queue: ReproductionRequest[] = [];
  private draining: Promise<void> | null = null;
  private disposed = false;
  private readonly seen = new Set<string>();

  constructor(
    private readonly browser: Browser,
    private readonly liveContext: BrowserContext,
    private readonly sink: ReproductionSink,
  ) {}

  /** Queue a finding for replay. Non-blocking; never throws into the caller. */
  public enqueue(request: ReproductionRequest): void {
    if (this.disposed) return;
    // One verdict per finding — a re-registration must not re-run the browser work.
    if (this.seen.has(request.bugId)) return;
    // A finding with no recorded timeline has nothing to replay; leaving `reproduced`
    // unset is correct — it keeps the score neutral instead of penalizing absent evidence.
    if (request.actions.length === 0) return;

    if (this.queue.length >= MAX_QUEUED) {
      console.warn(`[ReproductionProbe] queue full (${MAX_QUEUED}) — skipping repro for ${request.bugId}`);
      return;
    }
    this.seen.add(request.bugId);
    this.queue.push(request);
    void this.drain();
  }

  /** Await the in-flight replay and the queued backlog. Called at run teardown. */
  public async settle(): Promise<void> {
    await this.draining;
  }

  /** Stop accepting work and drop the backlog; an in-flight replay unwinds on its own. */
  public dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.drainLoop().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drainLoop(): Promise<void> {
    while (!this.disposed) {
      const request = this.queue.shift();
      if (!request) return;
      const outcome = await this.probe(request);
      if (outcome && !this.disposed) {
        try {
          this.sink(outcome);
        } catch (error) {
          console.warn(`[ReproductionProbe] sink failed for ${request.bugId}:`, error);
        }
      }
    }
  }

  /** Run one replay in a throwaway sidecar context. Returns null when undecidable. */
  private async probe(request: ReproductionRequest): Promise<ReproductionOutcome | null> {
    if (!this.browser.isConnected()) return null;

    let context: BrowserContext | null = null;
    try {
      context = await this.browser.newContext({
        viewport: { width: 1440, height: 900 },
        ignoreHTTPSErrors: true,
        // Inherit the live session so an authenticated run replays past the login wall.
        storageState: await this.liveContext.storageState().catch(() => undefined),
      });

      const result = await withTimeout(
        runReplaySession(context, {
          targetUrl: request.targetUrl,
          steps: buildActionSteps(request.actions),
          bugClass: request.bugClass,
          faultType: request.faultType,
          stateFingerprint: request.stateFingerprint,
          // The sidecar carries the live session, so a login wall here means the
          // replay genuinely cannot reach the surface — not a stale-credential artifact.
          guardLoginWall: false,
        }),
        PROBE_TIMEOUT_MS,
      );

      // An undecidable replay (nav failure, wedged page) must leave `reproduced`
      // unset rather than assert a negative — a false "did not reproduce" costs
      // 0.1 of confidence on a finding that may be perfectly real.
      if (!result || !result.ok) {
        console.warn(`[ReproductionProbe] undecidable for ${request.bugId}: ${result?.error ?? 'timed out'}`);
        return null;
      }

      return {
        bugId: request.bugId,
        reproduced: result.reproduced,
        stepsReplayed: result.stepsReplayed,
        matchedSignals: result.matchedSignals,
      };
    } catch (error) {
      console.warn(`[ReproductionProbe] failed for ${request.bugId}:`, error instanceof Error ? error.message : error);
      return null;
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms).unref?.()),
  ]);
}

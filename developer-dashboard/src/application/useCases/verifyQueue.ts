// ═══════════════════════════════════════════════════════════════════════════════
// verifyQueue.ts - single-flight FIFO queue for "Verify Fix" regression replays
// ═══════════════════════════════════════════════════════════════════════════════
// A regression replay drives a real headless browser, and the backend serializes
// replays PER OPERATOR (registerSocketHandlers verificationsInFlight): a second
// concurrent request from the same user is rejected outright. Firing replays in
// parallel from the UI therefore surfaced that rejection as a VERIFICATION_FAILED
// verdict — a false negative on a finding that was never actually replayed.
//
// This queue makes the client match the backend contract: at most one replay runs
// at a time; further requests wait their turn as 'queued' (never a failure), then
// drain FIFO. Framework-agnostic and side-effect-free beyond the injected executor,
// so it is unit-tested directly without React or a DOM.

import type { VerifyFixRequest, VerifyFixResult, VerifyFixProgress, VerifyFixPhase } from '../../types';

/**
 * Per-bug verification state as a discriminated union:
 *  - idle:    never verified (or reset).
 *  - queued:  waiting behind an in-flight replay — NOT a failure.
 *  - running: replay in flight, carrying the live phase + step progress.
 *  - done:    terminal VerifyFixResult (RESOLVED / STILL_ACTIVE / INCONCLUSIVE / VERIFICATION_FAILED).
 */
export type VerifyStatus =
  | { state: 'idle' }
  | { state: 'queued' }
  | { state: 'running'; phase: VerifyFixPhase; stepsReplayed: number; totalSteps: number }
  | { state: 'done'; result: VerifyFixResult };

export const IDLE_VERIFY_STATUS: VerifyStatus = { state: 'idle' };

/** Runs one replay to completion. Rejection is caught by the queue and turned into a terminal failed verdict. */
export type VerifyExecutor = (request: VerifyFixRequest) => Promise<VerifyFixResult>;

/** Terminal VERIFICATION_FAILED verdict for a transport/timeout error — the replay never produced a verdict. */
export function buildVerifyFailure(request: VerifyFixRequest, message: string): VerifyFixResult {
  return {
    ok: false,
    verdict: 'VERIFICATION_FAILED',
    reason: 'REPLAY_ERROR',
    sessionId: request.sessionId,
    bugId: request.bugId,
    bugClass: 'UNKNOWN',
    stepsReplayed: 0,
    stepStats: { total: 0, executed: 0, skipped: 0, failed: 0, finalStepExecuted: false },
    matchedSignals: [],
    otherSignals: [],
    timelineSource: 'finding',
    summary: `Verification request failed: ${message}`,
    durationMs: 0,
    error: message,
  };
}

export class VerifyQueue {
  private readonly pending: Array<{ request: VerifyFixRequest; resolve: (r: VerifyFixResult) => void }> = [];
  private readonly promises = new Map<string, Promise<VerifyFixResult>>();
  private statuses: Record<string, VerifyStatus> = {};
  private running = false;

  constructor(
    private readonly executor: VerifyExecutor,
    private readonly onChange: (statuses: Record<string, VerifyStatus>) => void,
  ) {}

  /** True while a replay is running or one is waiting to run. */
  isBusy(): boolean {
    return this.running || this.pending.length > 0;
  }

  getStatuses(): Record<string, VerifyStatus> {
    return this.statuses;
  }

  /**
   * Enqueue a verification. Resolves with the same terminal result stored in the
   * per-bug status. A duplicate request for a bug already queued/running returns the
   * existing in-flight promise instead of enqueuing a second replay.
   */
  enqueue(request: VerifyFixRequest): Promise<VerifyFixResult> {
    const existing = this.promises.get(request.bugId);
    if (existing) return existing;

    const promise = new Promise<VerifyFixResult>((resolve) => {
      this.pending.push({ request, resolve });
    });
    this.promises.set(request.bugId, promise);
    // Optimistically mark queued; pump() promotes the head item to running in the
    // same tick when idle, so a first/only request renders as running, not queued.
    this.setStatus(request.bugId, { state: 'queued' });
    void this.pump();
    return promise;
  }

  /**
   * Merge a streamed progress frame into the matching bug's status — but only while
   * that bug is still running, so a late frame can't overwrite a settled verdict or
   * animate a still-queued item.
   */
  applyProgress(progress: VerifyFixProgress): void {
    const current = this.statuses[progress.bugId];
    if (!current || current.state !== 'running') return;
    this.setStatus(progress.bugId, {
      state: 'running',
      phase: progress.phase,
      stepsReplayed: progress.stepsReplayed,
      totalSteps: progress.totalSteps,
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const item = this.pending.shift();
    if (!item) return;

    this.running = true;
    const { request, resolve } = item;
    this.setStatus(request.bugId, { state: 'running', phase: 'replaying', stepsReplayed: 0, totalSteps: 0 });

    let result: VerifyFixResult;
    try {
      result = await this.executor(request);
    } catch (error) {
      result = buildVerifyFailure(request, error instanceof Error ? error.message : String(error));
    }

    this.setStatus(request.bugId, { state: 'done', result });
    this.promises.delete(request.bugId);
    resolve(result);
    this.running = false;
    // Drain the next queued replay, if any.
    void this.pump();
  }

  // Immutable status write so subscribers (React setState) always see a new object.
  private setStatus(bugId: string, status: VerifyStatus): void {
    this.statuses = { ...this.statuses, [bugId]: status };
    this.onChange(this.statuses);
  }
}

import type { Server, Socket } from 'socket.io';
import {
  VERIFY_FIX_EVENT,
  VERIFY_FIX_PROGRESS_EVENT,
  SESSION_ATTACH_EVENT,
  QUEUE_SUBSCRIBE_EVENT,
  QUEUE_UPDATE_EVENT,
  type QueueSubscribeRequest,
  type QueueUpdate,
  type SessionAttachRequest,
  type SessionAttachAck,
  type VerifyFixRequest,
  type VerifyFixResult,
  type VerifyFixProgress,
  type StopReason,
  coerceClientStopReason,
} from '../../../../shared/types.js';
import { verifyTokenSync } from '../authentication/authConfig.js';
import { RegressionPlaybookVerifier } from '../../domain/services/regression/RegressionPlaybookVerifier.js';
import { sessionManager } from '../../application/services/SessionManager.js';
import { queueRoom, type QueueStatusBroadcaster } from '../../infrastructure/queue/QueueStatusBroadcaster.js';
import type { ControlBridgePublisher } from '../../infrastructure/queue/controlBridge.js';
import type { RunRegistry } from '../../infrastructure/queue/RunRegistry.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[Socket]');

/** Optional distributed-queue wiring, present only when BUGSAFARI_USE_QUEUE=1. */
export interface QueueSocketSupport {
  broadcaster: QueueStatusBroadcaster;
  // Bridges operator run-controls to the worker running the run out-of-process.
  controlPublisher: ControlBridgePublisher;
  // Redis run index — the authority on who owns a runToken across processes.
  runRegistry: RunRegistry;
}

// Single shared verifier; each verify() call owns its own isolated browser session.
const regressionVerifier = new RegressionPlaybookVerifier();
// A regression replay drives a real browser. Serialize verifications PER OPERATOR
// so a burst of clicks can't spawn parallel headless sessions for one user, while
// one operator's verification never blocks another's — the prior process-global
// boolean did both (cross-tenant denial). A hard timeout guarantees the slot is
// always released even if the replay browser hangs; the old flag, cleared only in
// finally, disabled verification process-wide until restart when a replay stuck.
const verificationsInFlight = new Set<string>();
const VERIFY_FIX_TIMEOUT_MS = 120_000;

// Per-socket abuse caps (SEC-07): a single client must not be able to join
// unbounded rooms (growing the adapter's maps until OOM) or flood inbound events.
const MAX_ROOMS_PER_SOCKET = 50;
const EVENT_BUDGET = 60;
const EVENT_WINDOW_MS = 10_000;

interface RateBucket { count: number; resetAt: number; }

// Token bucket per socket. Excess inbound events are dropped, not queued.
function withinEventBudget(socket: Socket): boolean {
  const now = Date.now();
  const bucket = socket.data.rate as RateBucket | undefined;
  if (!bucket || now >= bucket.resetAt) {
    socket.data.rate = { count: 1, resetAt: now + EVENT_WINDOW_MS };
    return true;
  }
  if (bucket.count >= EVENT_BUDGET) return false;
  bucket.count += 1;
  return true;
}

// Bounded join: refuse once a socket holds too many rooms (its own id room counts).
function joinLimited(socket: Socket, room: string): boolean {
  if (socket.rooms.has(room)) return true;
  if (socket.rooms.size >= MAX_ROOMS_PER_SOCKET) {
    obsLog.warn(`[Socket]  join cap (${MAX_ROOMS_PER_SOCKET}) reached for ${socket.id} — refusing ${room}`);
    return false;
  }
  void socket.join(room);
  return true;
}

/** Build a terminal VERIFICATION_FAILED ack without running a replay (validation/guard failures). */
function verificationFailedAck(request: Partial<VerifyFixRequest>, error: string): VerifyFixResult {
  return {
    ok: false,
    verdict: 'VERIFICATION_FAILED',
    reason: 'REPLAY_ERROR',
    sessionId: request.sessionId ?? '',
    bugId: request.bugId ?? '',
    bugClass: 'UNKNOWN',
    stepsReplayed: 0,
    stepStats: { total: 0, executed: 0, skipped: 0, failed: 0, finalStepExecuted: false },
    matchedSignals: [],
    otherSignals: [],
    timelineSource: 'finding',
    summary: `Verification failed: ${error}`,
    durationMs: 0,
    error,
  };
}

/** Resolve the authenticated userId from the socket handshake JWT, or null for guests. */
function socketUserId(socket: Socket): string | null {
  const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
  const decoded = token ? verifyTokenSync(token) : null;
  return decoded?.userId ?? null;
}

export function registerSocketHandlers(io: Server, queueSupport?: QueueSocketSupport): void {
  // Queue-mode abandonment. A run executing in a worker is invisible to this
  // process's SessionManager, so its disconnect-grace logic never fires and a
  // closed tab left the worker burning its full timebox. Mirror that grace here
  // and stop the run over the control bridge when nobody comes back.
  const queueGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelQueueGrace = (runToken: string): void => {
    const timer = queueGraceTimers.get(runToken);
    if (!timer) return;
    clearTimeout(timer);
    queueGraceTimers.delete(runToken);
    obsLog.info(`[Socket] Owner returned to run ${runToken} — abandonment timer cancelled.`);
  };

  const armQueueGrace = (runToken: string): void => {
    // Off by default: an abandoned worker run is not stopped, it runs to its timebox.
    if (!queueSupport || !sessionManager.terminateOnAbandon || queueGraceTimers.has(runToken)) return;
    const timer = setTimeout(() => {
      queueGraceTimers.delete(runToken);
      void (async () => {
        // Re-check occupancy: a client may have rejoined the room without
        // passing through the cancel path (fresh socket, new subscribe).
        const watchers = await io.in(`run:${runToken}`).fetchSockets();
        if (watchers.length > 0) return;
        const entry = await queueSupport.runRegistry.findByRunToken(runToken).catch(() => null);
        if (!entry) return;
        obsLog.info(`[Socket] Run ${runToken} abandoned past grace — stopping the worker.`);
        queueSupport.controlPublisher.publish('stop', runToken);
      })().catch((error) => obsLog.error('[Socket] Abandonment stop failed:', error));
    }, sessionManager.graceMs);
    timer.unref();
    queueGraceTimers.set(runToken, timer);
    obsLog.info(`[Socket] Run ${runToken} has no watchers — abandonment timer armed (${sessionManager.graceMs}ms).`);
  };

  io.on('connection', (socket: Socket) => {
    obsLog.info(`[Socket] dashboard connected ${socket.id}`);

    // Queue-mode ownership. A null/unknown runToken must NEVER reach the control
    // bridge: the worker treats runToken===null as "apply to my local run", so an
    // unscoped publish would pause/stop every run in the fleet from any anonymous
    // socket. The runToken must resolve to a live registry entry, and an authenticated
    // owner's run may only be driven by that same identity (possession of the
    // unguessable token remains the guest path).
    const ownsQueuedRun = async (runToken: string | null): Promise<boolean> => {
      if (!runToken || !queueSupport) return false;
      const entry = await queueSupport.runRegistry.findByRunToken(runToken).catch(() => null);
      if (!entry) return false;
      if (!entry.userId) return true;
      return entry.userId === socketUserId(socket);
    };

    // Distributed queue: a client that enqueued a run subscribes with its jobId +
    // runId, joining the queue-position room and — once ownership of the runId is
    // confirmed — the run room where bridged worker telemetry lands.
    socket.on(QUEUE_SUBSCRIBE_EVENT, async (payload: unknown) => {
      if (!withinEventBudget(socket)) return;
      const request = (payload ?? {}) as QueueSubscribeRequest;
      const jobId = typeof request.jobId === 'string' ? request.jobId.trim() : '';
      if (!jobId || !queueSupport) return;

      // Authorize the queue-position room (SEC-07): BullMQ job ids are sequential
      // integers, so joining queue:${jobId} unconditionally let any anonymous socket
      // enumerate the whole fleet's positions and failure messages. Require a runToken
      // the socket owns whose registry entry actually references THIS jobId — binding
      // the subscription to possession of the unguessable server-issued token.
      const runToken = typeof request.runToken === 'string' && request.runToken ? request.runToken : null;
      const entry = runToken ? await queueSupport.runRegistry.findByRunToken(runToken).catch(() => null) : null;
      const authorized = Boolean(
        entry && entry.jobId === jobId && (!entry.userId || entry.userId === socketUserId(socket)),
      );
      if (!authorized) {
        obsLog.warn(`[Socket]  queue-subscribe rejected: ${socket.id} does not own job ${jobId}`);
        return;
      }

      joinLimited(socket, queueRoom(jobId));
      // The run room streams that run's telemetry; the same proven ownership binds it.
      if (joinLimited(socket, `run:${runToken}`)) {
        socket.data.runToken = runToken;
        cancelQueueGrace(runToken!);
      }
      // Send the current place in line immediately, without waiting for the next
      // queue transition to fire a broadcast.
      void queueSupport.broadcaster.pushInitial(
        (update: QueueUpdate) => socket.emit(QUEUE_UPDATE_EVENT, update),
        jobId,
      );
    });

    // Reconnect / restore: a returning client presents the run token it owns and
    // is re-attached to the live run — rejoining its room and replaying buffered
    // telemetry — WITHOUT spawning a duplicate engine.
    socket.on(SESSION_ATTACH_EVENT, (payload: unknown, ack?: (result: SessionAttachAck) => void) => {
      const respond = typeof ack === 'function' ? ack : (): void => undefined;
      if (!withinEventBudget(socket)) return;
      const request = (payload ?? {}) as SessionAttachRequest;
      if (typeof request.runToken === 'string' && request.runToken) {
        socket.data.runToken = request.runToken;
      }
      const result = sessionManager.attach(socket, request.runToken, socketUserId(socket));
      if (result.attached) {
        obsLog.info(`[Socket] ${socket.id} re-attached to active run.`);
      }
      respond(result);
    });

    // Session control listeners. In queue mode the run executes in a worker
    // process, so the command is published over the control bridge scoped to the
    // socket's runId; otherwise it's applied to the in-process SessionManager.
    const controlPublisher = queueSupport?.controlPublisher ?? null;
    const socketRunToken = (): string | null => (typeof socket.data.runToken === 'string' ? socket.data.runToken : null);

    // In-process controls act on the single active run, so they must be scoped to
    // its owner — otherwise any connected socket could pause or kill a run it does
    // not own. Mirrors the ownership check on POST /api/safari/stop; the queue
    // branch enforces the equivalent via ownsQueuedRun.
    // Delegated to the manager's own check rather than re-deriving the rule here:
    // this copy accepted bare token possession even for an authenticated run, so it
    // drifted from SESSION_ATTACH the moment that rule was tightened.
    const ownsActiveRun = (): boolean =>
      sessionManager.ownsActiveRun(socketUserId(socket), socketRunToken() ?? undefined);

    const applyControl = async (label: string, command: 'pause' | 'resume' | 'stop', run: () => void, reason?: StopReason): Promise<void> => {
      if (!withinEventBudget(socket)) return;
      if (controlPublisher) {
        const runToken = socketRunToken();
        if (!(await ownsQueuedRun(runToken))) {
          obsLog.warn(`[Socket]  ${label} rejected: ${socket.id} does not own run ${runToken ?? '(none)'}`);
          return;
        }
        controlPublisher.publish(command, runToken, reason);
        return;
      }
      if (!ownsActiveRun()) {
        obsLog.warn(`[Socket]  ${label} rejected: ${socket.id} does not own the active run`);
        return;
      }
      obsLog.info(`[Socket] Session ${label} manually`);
      run();
    };

    socket.on('pause-test', () => void applyControl('PAUSED', 'pause', () => void sessionManager.pauseByOperator()));
    socket.on('resume-test', () => void applyControl('RESUMED', 'resume', () => sessionManager.resumeByOperator()));
    socket.on('stop-test', (payload?: { reason?: unknown }) => {
      const reason = coerceClientStopReason(payload?.reason);
      void applyControl('STOPPED', 'stop', () => void sessionManager.stopByOperator(reason), reason);
    });

    // Automated Regression Verification: replay a saved finding's recorded timeline
    // and report RESOLVED / STILL_ACTIVE. Uses an ack callback so the result is
    // delivered to the requesting socket only (no broadcast cross-talk); live
    // replay phases are streamed back over VERIFY_FIX_PROGRESS_EVENT meanwhile.
    socket.on(VERIFY_FIX_EVENT, async (payload: unknown, ack?: (result: VerifyFixResult) => void) => {
      const respond = typeof ack === 'function' ? ack : (): void => undefined;
      if (!withinEventBudget(socket)) {
        respond(verificationFailedAck((payload ?? {}) as Partial<VerifyFixRequest>, 'Too many requests. Please retry shortly.'));
        return;
      }
      const request = (payload ?? {}) as Partial<VerifyFixRequest>;

      // Payload validation.
      if (typeof request.sessionId !== 'string' || !request.sessionId || typeof request.bugId !== 'string' || !request.bugId) {
        respond(verificationFailedAck(request, 'sessionId and bugId are required.'));
        return;
      }

      // Least privilege: resolve the user from the handshake JWT and scope the
      // finding lookup to them. The client never supplies its own userId.
      const userId = socketUserId(socket);
      if (!userId) {
        respond(verificationFailedAck(request, 'Authentication required to verify a fix.'));
        return;
      }

      // Serialize replays per operator to avoid parallel headless-browser storms
      // for one user, without denying other operators.
      if (verificationsInFlight.has(userId)) {
        respond(verificationFailedAck(request, 'Another verification is already in progress. Please retry shortly.'));
        return;
      }

      verificationsInFlight.add(userId);
      obsLog.info(`[Socket] verify-fix requested by user ${userId} for session ${request.sessionId} bug ${request.bugId}`);
      try {
        // Race the replay against a hard timeout so a hung browser can never keep
        // this operator's slot (or, previously, the whole process) locked.
        const result = await Promise.race([
          regressionVerifier.verify(
            { sessionId: request.sessionId, bugId: request.bugId },
            userId,
            (progress: VerifyFixProgress) => socket.emit(VERIFY_FIX_PROGRESS_EVENT, progress),
          ),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Verification timed out after ${Math.round(VERIFY_FIX_TIMEOUT_MS / 1000)}s.`)),
              VERIFY_FIX_TIMEOUT_MS,
            );
            timer.unref();
          }),
        ]);
        respond(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        obsLog.error('[Socket] verify-fix failed:', message);
        respond(verificationFailedAck(request, `Verification error: ${message}`));
      } finally {
        verificationsInFlight.delete(userId);
      }
    });

    socket.on('disconnect', () => {
      obsLog.info(`[Socket] dashboard disconnected ${socket.id}`);
      // Grace-period keep-alive: the manager keeps the engine running for a
      // configurable window so a refresh / transient drop can reconnect instead
      // of losing the run. Only the LAST owner socket leaving arms the timer.
      sessionManager.handleDisconnect(socket.id);

      // Distributed equivalent: the run lives in a worker, so SessionManager has
      // nothing to grace. Arm our own once the run room is empty.
      const runToken = socketRunToken();
      if (!queueSupport || !runToken) return;
      void io.in(`run:${runToken}`).fetchSockets()
        .then((watchers) => { if (watchers.length === 0) armQueueGrace(runToken); })
        .catch((error) => obsLog.error('[Socket] Abandonment check failed:', error));
    });
  });
}

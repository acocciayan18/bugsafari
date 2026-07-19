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
} from '../../../../shared/types.js';
import { verifyTokenSync } from '../authentication/authConfig.js';
import { RegressionPlaybookVerifier } from '../../domain/services/regression/RegressionPlaybookVerifier.js';
import { sessionManager } from '../../application/services/SessionManager.js';
import { queueRoom, type QueueStatusBroadcaster } from '../../infrastructure/queue/QueueStatusBroadcaster.js';
import type { ControlBridgePublisher } from '../../infrastructure/queue/controlBridge.js';
import type { RunRegistry } from '../../infrastructure/queue/RunRegistry.js';

/** Optional distributed-queue wiring, present only when BUGSAFARI_USE_QUEUE=1. */
export interface QueueSocketSupport {
  broadcaster: QueueStatusBroadcaster;
  // Bridges operator run-controls to the worker running the run out-of-process.
  controlPublisher: ControlBridgePublisher;
  // Redis run index — the authority on who owns a runId across processes.
  runRegistry: RunRegistry;
}

// Single shared verifier; each verify() call owns its own isolated browser session.
const regressionVerifier = new RegressionPlaybookVerifier();
// A regression replay drives a real browser — serialize verifications so a burst
// of clicks can't spawn parallel headless sessions and exhaust resources.
let verificationInProgress = false;

/** Build a terminal INCONCLUSIVE ack without running a replay (validation/guard failures). */
function inconclusiveAck(request: Partial<VerifyFixRequest>, error: string): VerifyFixResult {
  return {
    ok: false,
    verdict: 'INCONCLUSIVE',
    sessionId: request.sessionId ?? '',
    bugId: request.bugId ?? '',
    bugClass: 'UNKNOWN',
    stepsReplayed: 0,
    matchedSignals: [],
    summary: `Verification inconclusive: ${error}`,
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
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] dashboard connected ${socket.id}`);

    // Queue-mode ownership. A null/unknown runId must NEVER reach the control
    // bridge: the worker treats runId===null as "apply to my local run", so an
    // unscoped publish would pause/stop every run in the fleet from any anonymous
    // socket. The runId must resolve to a live registry entry, and an authenticated
    // owner's run may only be driven by that same identity (possession of the
    // unguessable token remains the guest path).
    const ownsQueuedRun = async (runId: string | null): Promise<boolean> => {
      if (!runId || !queueSupport) return false;
      const entry = await queueSupport.runRegistry.findByRunId(runId).catch(() => null);
      if (!entry) return false;
      if (!entry.userId) return true;
      return entry.userId === socketUserId(socket);
    };

    // Distributed queue: a client that enqueued a run subscribes with its jobId +
    // runId, joining the queue-position room and — once ownership of the runId is
    // confirmed — the run room where bridged worker telemetry lands.
    socket.on(QUEUE_SUBSCRIBE_EVENT, async (payload: unknown) => {
      const request = (payload ?? {}) as QueueSubscribeRequest;
      const jobId = typeof request.jobId === 'string' ? request.jobId.trim() : '';
      if (!jobId || !queueSupport) return;

      void socket.join(queueRoom(jobId));
      // The run room streams that run's telemetry — bind it only to a runId this
      // socket actually owns, so a bogus/foreign id can't be used to eavesdrop or
      // to seed socket.data.runId for a later control command.
      const runId = typeof request.runId === 'string' && request.runId ? request.runId : null;
      if (runId && (await ownsQueuedRun(runId))) {
        void socket.join(`run:${runId}`);
        socket.data.runId = runId;
      } else if (runId) {
        console.warn(`[Socket] ❌ queue-subscribe rejected run binding: ${socket.id} does not own run ${runId}`);
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
      const request = (payload ?? {}) as SessionAttachRequest;
      if (typeof request.runId === 'string' && request.runId) {
        socket.data.runId = request.runId;
      }
      const result = sessionManager.attach(socket, request.runId, socketUserId(socket));
      if (result.attached) {
        console.log(`[Socket] ${socket.id} re-attached to active run.`);
      }
      respond(result);
    });

    // Session control listeners. In queue mode the run executes in a worker
    // process, so the command is published over the control bridge scoped to the
    // socket's runId; otherwise it's applied to the in-process SessionManager.
    const controlPublisher = queueSupport?.controlPublisher ?? null;
    const socketRunId = (): string | null => (typeof socket.data.runId === 'string' ? socket.data.runId : null);

    // In-process controls act on the single active run, so they must be scoped to
    // its owner — otherwise any connected socket could pause or kill a run it does
    // not own. Mirrors the ownership check on POST /api/safari/stop; the queue
    // branch enforces the equivalent via ownsQueuedRun.
    const ownsActiveRun = (): boolean => {
      const activeRunId = sessionManager.getActiveRunId();
      if (!activeRunId) return false;
      // Possession of the run token proves ownership (same trust model as
      // SESSION_ATTACH) — the dashboard socket carries no JWT. A matching
      // authenticated identity is accepted as the alternative proof.
      if (socketRunId() === activeRunId) return true;
      const activeUserId = sessionManager.getActiveUserId();
      return activeUserId !== null && activeUserId === socketUserId(socket);
    };

    const applyControl = async (label: string, command: 'pause' | 'resume' | 'stop', run: () => void): Promise<void> => {
      if (controlPublisher) {
        const runId = socketRunId();
        if (!(await ownsQueuedRun(runId))) {
          console.warn(`[Socket] ❌ ${label} rejected: ${socket.id} does not own run ${runId ?? '(none)'}`);
          return;
        }
        controlPublisher.publish(command, runId);
        return;
      }
      if (!ownsActiveRun()) {
        console.warn(`[Socket] ❌ ${label} rejected: ${socket.id} does not own the active run`);
        return;
      }
      console.log(`[Socket] Session ${label} manually`);
      run();
    };

    socket.on('pause-test', () => void applyControl('PAUSED', 'pause', () => void sessionManager.pauseByOperator()));
    socket.on('resume-test', () => void applyControl('RESUMED', 'resume', () => sessionManager.resumeByOperator()));
    socket.on('stop-test', () => void applyControl('STOPPED', 'stop', () => void sessionManager.stopByOperator()));

    // Automated Regression Verification: replay a saved finding's recorded timeline
    // and report RESOLVED / STILL_ACTIVE. Uses an ack callback so the result is
    // delivered to the requesting socket only (no broadcast cross-talk); live
    // replay phases are streamed back over VERIFY_FIX_PROGRESS_EVENT meanwhile.
    socket.on(VERIFY_FIX_EVENT, async (payload: unknown, ack?: (result: VerifyFixResult) => void) => {
      const respond = typeof ack === 'function' ? ack : (): void => undefined;
      const request = (payload ?? {}) as Partial<VerifyFixRequest>;

      // Payload validation.
      if (typeof request.sessionId !== 'string' || !request.sessionId || typeof request.bugId !== 'string' || !request.bugId) {
        respond(inconclusiveAck(request, 'sessionId and bugId are required.'));
        return;
      }

      // Least privilege: resolve the user from the handshake JWT and scope the
      // finding lookup to them. The client never supplies its own userId.
      const userId = socketUserId(socket);
      if (!userId) {
        respond(inconclusiveAck(request, 'Authentication required to verify a fix.'));
        return;
      }

      // Serialize replays to avoid parallel headless-browser storms.
      if (verificationInProgress) {
        respond(inconclusiveAck(request, 'Another verification is already in progress. Please retry shortly.'));
        return;
      }

      verificationInProgress = true;
      console.log(`[Socket] verify-fix requested by user ${userId} for session ${request.sessionId} bug ${request.bugId}`);
      try {
        const result = await regressionVerifier.verify(
          { sessionId: request.sessionId, bugId: request.bugId },
          userId,
          (progress: VerifyFixProgress) => socket.emit(VERIFY_FIX_PROGRESS_EVENT, progress),
        );
        respond(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Socket] verify-fix failed:', message);
        respond(inconclusiveAck(request, `Verification error: ${message}`));
      } finally {
        verificationInProgress = false;
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] dashboard disconnected ${socket.id}`);
      // Grace-period keep-alive: the manager keeps the engine running for a
      // configurable window so a refresh / transient drop can reconnect instead
      // of losing the run. Only the LAST owner socket leaving arms the timer.
      sessionManager.handleDisconnect(socket.id);
    });
  });
}

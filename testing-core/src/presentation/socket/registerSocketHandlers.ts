import type { Server, Socket } from 'socket.io';
import {
  VERIFY_FIX_EVENT,
  VERIFY_FIX_PROGRESS_EVENT,
  SESSION_ATTACH_EVENT,
  type SessionAttachRequest,
  type SessionAttachAck,
  type VerifyFixRequest,
  type VerifyFixResult,
  type VerifyFixProgress,
} from '../../../../shared/types.js';
import { verifyTokenSync } from '../authentication/authConfig.js';
import { RegressionPlaybookVerifier } from '../../domain/services/regression/RegressionPlaybookVerifier.js';
import { sessionManager } from '../../application/services/SessionManager.js';

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

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] dashboard connected ${socket.id}`);

    // Reconnect / restore: a returning client presents the run token it owns and
    // is re-attached to the live run — rejoining its room and replaying buffered
    // telemetry — WITHOUT spawning a duplicate engine.
    socket.on(SESSION_ATTACH_EVENT, (payload: unknown, ack?: (result: SessionAttachAck) => void) => {
      const respond = typeof ack === 'function' ? ack : (): void => undefined;
      const request = (payload ?? {}) as SessionAttachRequest;
      const result = sessionManager.attach(socket, request.runId, socketUserId(socket));
      if (result.attached) {
        console.log(`[Socket] ${socket.id} re-attached to active run.`);
      }
      respond(result);
    });

    // Session control listeners — all routed through the centralized manager so
    // pause origin (operator vs. target-outage) and grace state stay coherent.
    socket.on('pause-test', () => {
      console.log('[Socket] Session PAUSED manually');
      sessionManager.pauseByOperator();
    });

    socket.on('resume-test', () => {
      console.log('[Socket] Session RESUMED manually');
      sessionManager.resumeByOperator();
    });

    socket.on('stop-test', () => {
      console.log('[Socket] Session STOPPED manually');
      void sessionManager.stopByOperator();
    });

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

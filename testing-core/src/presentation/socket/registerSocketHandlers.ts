import type { Server, Socket } from 'socket.io';
import { VERIFY_FIX_EVENT, type VerifyFixRequest, type VerifyFixResult } from '../../../../shared/types.js';
import { verifyTokenSync } from '../authentication/authConfig.js';
import { RegressionPlaybookVerifier } from '../../domain/services/regression/RegressionPlaybookVerifier.js';

interface EngineControl {
  pause?: () => void;
  resume?: () => void;
  stop?: () => Promise<void> | void;
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

interface ActiveEngineSession {
  engine: EngineControl;
  ownerSocketId: string | null;
}

// Global reference to the currently running engine control surface
let activeEngineSession: ActiveEngineSession | null = null;

export let activeEngineInstance: EngineControl | null = null;

export function setActiveEngine(engine: EngineControl | null, ownerSocketId: string | null = null) {
  activeEngineInstance = engine;
  activeEngineSession = engine ? { engine, ownerSocketId } : null;
}

function emitEngineAction(io: Server, actionExecuted: string, message: string): void {
  io.emit('telemetry', {
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted,
      message,
    },
  });
}

/**
 * Emit explicit engine status - provides deterministic state handshake.
 * Forces clean state transition to IDLE when session terminates.
 */
function emitEngineStatus(io: Server, status: 'IDLE' | 'STOPPED'): void {
  io.emit('telemetry', {
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted: 'engine-status',
      message: status,
    },
  });
  console.log(`[Socket] Engine status emitted: ${status}`);
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] dashboard connected ${socket.id}`);

    // Session Control Listeners
    socket.on('pause-test', () => {
      console.log('[Socket] Session PAUSED manually');
      if (activeEngineSession?.engine && typeof activeEngineSession.engine.pause === 'function') {
        activeEngineSession.engine.pause();
        if (!activeEngineSession.ownerSocketId) {
          activeEngineSession.ownerSocketId = socket.id;
        }
        emitEngineAction(io, 'engine-paused', 'Safari session paused by user.');
      }
    });

    socket.on('resume-test', () => {
      console.log('[Socket] Session RESUMED manually');
      if (activeEngineSession?.engine && typeof activeEngineSession.engine.resume === 'function') {
        activeEngineSession.engine.resume();
        emitEngineAction(io, 'engine-resumed', 'Safari session resumed by user.');
      }
    });

socket.on('stop-test', () => {
      console.log('[Socket] Session STOPPED manually');
      if (activeEngineSession?.engine && typeof activeEngineSession.engine.stop === 'function') {
        void Promise.resolve(activeEngineSession.engine.stop()).finally(() => {
          activeEngineSession = null;
          activeEngineInstance = null;
          // Emit explicit IDLE status after cleanup - ensures deterministic state handshake
          emitEngineAction(io, 'engine-stopped', 'Safari session stopped by user.');
          emitEngineStatus(io, 'IDLE');
        });
      }
    });

// Automated Regression Verification: replay a saved finding's recorded timeline
    // and report VERIFIED / BUG_PERSISTS. Uses an ack callback so the result is
    // delivered to the requesting socket only (no broadcast cross-talk).
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
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      const decoded = token ? verifyTokenSync(token) : null;
      if (!decoded?.userId) {
        respond(inconclusiveAck(request, 'Authentication required to verify a fix.'));
        return;
      }

      // Serialize replays to avoid parallel headless-browser storms.
      if (verificationInProgress) {
        respond(inconclusiveAck(request, 'Another verification is already in progress. Please retry shortly.'));
        return;
      }

      verificationInProgress = true;
      console.log(`[Socket] verify-fix requested by user ${decoded.userId} for session ${request.sessionId} bug ${request.bugId}`);
      try {
        const result = await regressionVerifier.verify(
          { sessionId: request.sessionId, bugId: request.bugId },
          decoded.userId,
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

      if (
        activeEngineSession?.engine &&
        typeof activeEngineSession.engine.stop === 'function' &&
        activeEngineSession.ownerSocketId === socket.id
      ) {
        console.log('[Socket] Owner disconnected while engine active; forcing stop to prevent stale active state.');
        void Promise.resolve(activeEngineSession.engine.stop()).finally(() => {
          activeEngineSession = null;
          activeEngineInstance = null;
          // Emit explicit IDLE status after cleanup
          emitEngineAction(io, 'engine-stopped', 'Safari session stopped after dashboard disconnect.');
          emitEngineStatus(io, 'IDLE');
        });
      }
    });
  });
}

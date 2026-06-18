import type { Server, Socket } from 'socket.io';

interface EngineControl {
  pause?: () => void;
  resume?: () => void;
  stop?: () => Promise<void> | void;
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

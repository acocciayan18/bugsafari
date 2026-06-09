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

// 🚨 FIX: Promise-based Mutex for Task 4 - Prevents race conditions on concurrent socket handler execution
// Ensures that only one handler can access/modify activeEngineSession at a time
let engineOperationLock: Promise<void> = Promise.resolve();

function acquireEngineLock(): Promise<void> {
  let releaseLock: () => void;
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // Chain to existing lock and store release function
  engineOperationLock = engineOperationLock.then(() => lock).then(() => releaseLock());
  return lock;
}

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
 * 🚨 FIX: Task 4 - Safe execution wrapper with mutex locking
 * Wraps engine operations to prevent race conditions when accessing activeEngineSession
 * @param operation The callback that performs the actual engine action
 * @returns Promise that resolves when the operation completes
 */
async function withEngineLock<T>(operation: () => T | Promise<T>): Promise<T> {
  await acquireEngineLock();
  return operation();
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] dashboard connected ${socket.id}`);

    // Session Control Listeners
    socket.on('pause-test', async () => {
      console.log('[Socket] Session PAUSED manually');
      await withEngineLock(() => {
        // 🚨 FIX: Strict null-check at moment of execution (Task 4)
        if (activeEngineSession?.engine && typeof activeEngineSession.engine.pause === 'function') {
          activeEngineSession.engine.pause();
          if (!activeEngineSession.ownerSocketId) {
            activeEngineSession.ownerSocketId = socket.id;
          }
          emitEngineAction(io, 'engine-paused', 'Safari session paused by user.');
        }
      });
    });

    socket.on('resume-test', async () => {
      console.log('[Socket] Session RESUMED manually');
      await withEngineLock(() => {
        // 🚨 FIX: Strict null-check at moment of execution (Task 4)
        if (activeEngineSession?.engine && typeof activeEngineSession.engine.resume === 'function') {
          activeEngineSession.engine.resume();
          emitEngineAction(io, 'engine-resumed', 'Safari session resumed by user.');
        }
      });
    });

    socket.on('stop-test', async () => {
      console.log('[Socket] Session STOPPED manually');
      await withEngineLock(async () => {
        // 🚨 FIX: Strict null-check at moment of execution (Task 4)
        const engine = activeEngineSession?.engine;
        if (engine && typeof engine.stop === 'function') {
          await Promise.resolve(engine.stop());
          activeEngineSession = null;
          activeEngineInstance = null;
          emitEngineAction(io, 'engine-stopped', 'Safari session stopped by user.');
        }
      });
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket] dashboard disconnected ${socket.id}`);

      await withEngineLock(async () => {
        // 🚨 FIX: Strict null-check at moment of execution (Task 4)
        const engine = activeEngineSession?.engine;
        if (engine && typeof engine.stop === 'function' && activeEngineSession?.ownerSocketId === socket.id) {
          console.log('[Socket] Owner disconnected while engine active; forcing stop to prevent stale active state.');
          await Promise.resolve(engine.stop());
          activeEngineSession = null;
          activeEngineInstance = null;
          emitEngineAction(io, 'engine-stopped', 'Safari session stopped after dashboard disconnect.');
        }
      });
    });
  });
}

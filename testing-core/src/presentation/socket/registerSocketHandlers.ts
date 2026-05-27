import type { Server, Socket } from 'socket.io';
import type { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';

// Global reference to the currently running engine
export let activeEngineInstance: AutonomousExplorationEngine | null = null;

export function setActiveEngine(engine: any | null) {
  activeEngineInstance = engine;
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] dashboard connected ${socket.id}`);

    // Session Control Listeners
    socket.on('pause-test', () => {
      console.log('[Socket] Session PAUSED manually');
      if (activeEngineInstance && typeof activeEngineInstance.pause === 'function') {
        activeEngineInstance.pause();
      }
    });

    socket.on('resume-test', () => {
      console.log('[Socket] Session RESUMED manually');
      if (activeEngineInstance && typeof activeEngineInstance.resume === 'function') {
        activeEngineInstance.resume();
      }
    });

    socket.on('stop-test', () => {
      console.log('[Socket] Session STOPPED manually');
      if (activeEngineInstance && typeof activeEngineInstance.stop === 'function') {
        activeEngineInstance.stop();
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] dashboard disconnected ${socket.id}`);
    });
  });
}
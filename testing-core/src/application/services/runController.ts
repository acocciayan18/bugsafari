import type { TelemetryHub } from '../../infrastructure/monitoring/socketServer.js';
import type { RunController } from '../../types.js';
import type { BrowserEngine } from '../ports/BrowserEngine.js';

/**
 * Global session cleanup method - ensures deterministic state boundaries.
 * Wraps all browser resource cleanup in strict try/catch and emits explicit IDLE status.
 */
export async function terminateAndResetSafariSession(
  telemetryHub: TelemetryHub,
  browserEngine?: BrowserEngine
): Promise<void> {
  console.log('[runController] terminateAndResetSafariSession: Starting cleanup...');

// 1. Strict try/catch for browser cleanup - prevents orphaned processes
  if (browserEngine && typeof browserEngine.stop === 'function') {
    try {
      await browserEngine.stop();
      console.log('[runController] Browser engine stopped successfully');
    } catch (browserError) {
      console.error('[runController] Browser cleanup error:', browserError);
    }
  }

  // 2. Emit explicit IDLE status - forces clean state transition
  telemetryHub.emitTelemetry({
    timestamp: new Date().toISOString(),
    type: 'ACTION',
    meta: {
      actionExecuted: 'engine-status',
      message: 'IDLE',
    },
  });

  console.log('[runController] terminateAndResetSafariSession: Session reset complete, status IDLE');
}

export function createRunController(telemetryHub: TelemetryHub, targetUrl: string): RunController {

  let paused = false;
  let stopRequested = false;


  // Promise machinery for waitIfPaused
  let resumeResolver: (() => void) | null = null;

  const waitIfPaused = async (): Promise<void> => {
    // Clear any stop: if stop requested, return immediately.
    if (stopRequested) return;

    // If we are not paused, exit.
    if (!paused) return;

    // Otherwise, wait until resume is signaled or stop is requested.
    await new Promise<void>((resolve) => {
      resumeResolver = resolve;
    });
  };

  const requestStop = (): void => {
    stopRequested = true;

    // Unblock any waiter.
    if (resumeResolver) {
      resumeResolver();
      resumeResolver = null;
    }

    telemetryHub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: {
        actionExecuted: 'engine-halt',
        url: targetUrl,
        message: 'Stop requested by dashboard.',
      },
    });
  };

  const isStopRequested = (): boolean => stopRequested;

  const getPaused = (): boolean => paused;

  const setPausedInternal = (nextPaused: boolean) => {
    paused = nextPaused;

    if (!paused && resumeResolver) {
      resumeResolver();
      resumeResolver = null;
    }
  };

  // We interpret toggle-pause as flip, but keep controller API minimal.
  // pausing/resuming are handled by mutating `paused` through closures.
  // Pause is represented by `pausedRequested` only for potential future use.
  const controller: RunController = {
    waitIfPaused,
    setPaused: (p: boolean) => setPausedInternal(p),
    togglePaused: () => setPausedInternal(!paused),
    requestStop,
    isStopRequested,
    getPaused,
  };




  return controller;

}

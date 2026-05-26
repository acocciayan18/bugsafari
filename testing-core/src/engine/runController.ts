import type { TelemetryHub } from '../reporters/socketServer.js';
import type { RunController } from './autonomousLoop.js';

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

    telemetryHub.emitTelemetry('ACTION', {
      actionExecuted: 'engine-halt',
      url: targetUrl,
      message: 'Stop requested by dashboard.',
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


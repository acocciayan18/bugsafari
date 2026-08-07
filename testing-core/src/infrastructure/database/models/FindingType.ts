/**
 * Enum representing the types of findings that can be detected during exploration
 */
export enum FindingType {
  ACTION = 'ACTION',
  NETWORK = 'NETWORK',
  EXCEPTION = 'EXCEPTION',
  HEURISTIC_SCORE = 'HEURISTIC_SCORE',
  RUNTIME_UI_FREEZE = 'RUNTIME_UI_FREEZE',
  SESSION_SYNC_FAULT = 'SESSION_SYNC_FAULT',
}

/**
 * Enum representing the status of an exploration session
 */
export enum SessionStatus {
  RUNNING = 'Running',
  COMPLETED = 'Completed',
  CRASHED = 'Crashed',
  PAUSED = 'Paused',
  // Recovery lifecycle: owner dropped but engine kept alive inside the grace
  // window (INTERRUPTED), or grace expired and the run was torn down (DISCONNECTED).
  INTERRUPTED = 'Interrupted',
  DISCONNECTED = 'Disconnected',
  // Termination taxonomy: an operator stop, a time-budget expiry, an early
  // controlled bail-out, and a run whose operator never came back are each
  // distinct from a clean Completed and from a Crashed engine failure.
  STOPPED = 'Stopped',
  TIMED_OUT = 'TimedOut',
  HALTED = 'Halted',
  ABANDONED = 'Abandoned',
  // A BugSafari engine / Playwright / environment failure — distinct from a Crashed
  // target app, so History can tell "our engine broke" from "the app under test broke".
  ENGINE_ERROR = 'EngineError',
}

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
}

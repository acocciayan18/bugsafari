// ═══════════════════════════════════════════════════════════════
// shared/types/termination.ts - HOW AND WHY A RUN ENDED
// ═══════════════════════════════════════════════════════════════
// One taxonomy plus one copy table, shared by the engine, persistence, and every
// dashboard surface — so a termination reason can never drift between them.

/** Why a run ended. */
export type RunTerminationOutcome =
  | 'completed'           // exploration budget/graph exhausted normally
  | 'boundary-saturated'  // configured scope fully explored — NOT the whole app graph
  | 'user-stopped'        // operator explicitly hit stop
  | 'timebox'             // configured time limit reached
  | 'graceful-shutdown'   // controlled bail-out (unrecoverable page state, auth failure)
  | 'target-crash'        // target server confirmed dead by health probes
  | 'abandoned'           // operator disconnected and never returned within the grace window
  | 'engine-error'        // BugSafari engine / Playwright / environment failure — NOT a target defect
  | 'queue-cancelled'     // queued run cancelled before a worker ever executed it
  | 'exception';          // unhandled failure attributed to the target application

/** Who asked the engine to stop. Carried through teardown so a resulting
 *  browser-closed error is attributed to its real cause, not to the operator. */
export type StopReason = 'operator' | 'timebox' | 'target-crash' | 'disconnect-grace' | 'pause-timeout' | 'internal-shutdown' | 'queue-cancelled' | 'harness-resource' | 'harness-environment';

/** Terminal outcome implied by each stop trigger. */
export const STOP_REASON_OUTCOME: Record<StopReason, RunTerminationOutcome> = {
  operator: 'user-stopped',
  timebox: 'timebox',
  'target-crash': 'target-crash',
  'disconnect-grace': 'abandoned',
  'pause-timeout': 'abandoned',
  'internal-shutdown': 'graceful-shutdown',
  'queue-cancelled': 'queue-cancelled',
  'harness-resource': 'engine-error',
  'harness-environment': 'engine-error',
};

/** Stop reasons a dashboard client is allowed to assert over the wire. Every other
 *  reason (crash, disconnect, shutdown, queue-cancelled) is server-authoritative and
 *  can never be spoofed by a client — an unknown/forbidden value coerces to `operator`.
 *  `queue-cancelled` is deliberately excluded: a client must not be able to attribute
 *  an executing engine stop as a queue cancellation; the API stamps it itself when it
 *  removes a still-waiting job. */
export const CLIENT_STOP_REASONS: readonly StopReason[] = ['operator', 'timebox'];

export function coerceClientStopReason(value: unknown): StopReason {
  return typeof value === 'string' && (CLIENT_STOP_REASONS as readonly string[]).includes(value)
    ? (value as StopReason)
    : 'operator';
}

/** Operator-facing sentence for each stop trigger. */
export const STOP_REASON_DETAIL: Record<StopReason, string> = {
  operator: 'Session stopped by the operator.',
  timebox: 'Session ended automatically because the configured time budget was reached.',
  'target-crash': 'Session terminated because the target application stopped responding.',
  'disconnect-grace': 'Session terminated because the operator disconnected and did not return within the grace window.',
  'pause-timeout': 'Session terminated because it remained paused beyond the maximum pause window.',
  'internal-shutdown': 'Session terminated by an internal engine shutdown.',
  'queue-cancelled': 'Queued session cancelled before a worker started it.',
  'harness-resource':
    'Session stopped because BugSafari ran out of memory. Raise the container memory limit, lower run concurrency, or free host memory, then re-run.',
  'harness-environment':
    'Session stopped because the browser environment crashed due to a possible GPU or driver fault. This is a BugSafari or environment issue, not a target defect.',
};

/** Operator-facing copy per outcome. `label` is the badge, `detail` the sentence. */
export const TERMINATION_COPY: Record<
  RunTerminationOutcome,
  { label: string; detail: string; icon: string }
> = {
  completed: {
    label: 'Completed',
    icon: '',
    detail: 'Exploration finished because the action budget was exhausted.',
  },
  'boundary-saturated': {
    label: 'Scope Covered',
    icon: '',
    detail: 'Configured scope was fully explored and every discovered control was triggered.',
  },
  'user-stopped': {
    label: 'Stopped by Operator',
    icon: '',
    detail: 'Session stopped by the operator.',
  },
  timebox: {
    label: 'Time Limit Reached',
    icon: '',
    detail: 'Session ended automatically because the configured time budget was reached.',
  },
  'graceful-shutdown': {
    label: 'Halted',
    icon: '',
    detail: 'Session ended early because the engine could not continue safely.',
  },
  'target-crash': {
    label: 'Target Crashed',
    icon: '',
    detail: 'Session terminated because the target application stopped responding.',
  },
  abandoned: {
    label: 'Abandoned',
    icon: '',
    detail: 'Session terminated because the operator disconnected and did not return.',
  },
  'engine-error': {
    label: 'Engine Error',
    icon: '',
    detail: 'Session ended بسبب a BugSafari engine or environment failure, not a defect in the target application.',
  },
  'queue-cancelled': {
    label: 'Queue Cancelled',
    icon: '',
    detail: 'Queued session was cancelled before a worker started. No exploration was performed.',
  },
  exception: {
    label: 'Crashed',
    icon: '',
    detail: 'Session terminated because of an unhandled failure in the target application.',
  },
};

/** Single source of truth for how a termination reads across every surface. */
export function describeTermination(outcome: RunTerminationOutcome, reason?: string): string {
  const copy = TERMINATION_COPY[outcome] ?? TERMINATION_COPY.exception;
  return reason && reason.trim() ? `${copy.icon} ${copy.label}: ${reason}` : `${copy.icon} ${copy.detail}`;
}

/** True when the outcome represents a healthy end rather than a fault. */
export function isCleanTermination(outcome: RunTerminationOutcome): boolean {
  return outcome === 'completed' || outcome === 'boundary-saturated' || outcome === 'user-stopped' || outcome === 'timebox' || outcome === 'queue-cancelled';
}

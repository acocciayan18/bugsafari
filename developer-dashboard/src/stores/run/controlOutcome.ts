import type { RunControlOutcome } from '../../application/ports/EngineGateway';
import type { TestSessionStatus } from './types';

/**
 * Should an optimistic control transition be rolled back?
 *
 * ONLY an explicit server refusal rolls back. A transport failure (no ack, HTTP error,
 * offline) proves nothing about whether the command landed — the engine may well be
 * pausing right now — and reverting on one would show ACTIVE for a run that is actually
 * stopping. Those cases are left to the re-delivery loop and the engine's own telemetry,
 * which are authoritative about the real state.
 */
export function shouldRollbackControl(outcome: RunControlOutcome): boolean {
  return !outcome.ok && outcome.reason !== undefined;
}

/** Operator-facing prose for an explicit refusal. */
export function refusalMessage(reason: RunControlOutcome['reason'], verb: string): string {
  if (reason === 'no-active-session') return `There is no running session to ${verb}.`;
  if (reason === 'not-owner') return `You do not have permission to ${verb} this session.`;
  if (reason === 'rate-limited') return 'Too many requests. Wait a moment and try again.';
  return `We couldn't ${verb} the session. Please try again.`;
}

/**
 * Is this rollback still valid? The status may have moved on between issuing the
 * command and the refusal arriving (the engine settled, the run ended, the operator
 * pressed Stop). Applying a stale rollback then would resurrect a dead state.
 */
export function canApplyRollback(current: TestSessionStatus, optimistic: TestSessionStatus): boolean {
  return current === optimistic;
}

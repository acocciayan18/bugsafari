// Launch admission for the distributed path, as a pure decision so it is testable
// without Redis (same shape as readMaxQueueDepth / waitingUpdates / raceSlotRelease).
//
// QUEUED is a mirror of BullMQ's `waiting` state, not a capacity verdict: the API
// enqueued every non-guest launch unconditionally and only a worker process could
// promote it. With no worker connected the job pinned at `waiting` forever while the
// dashboard rendered an ordinary, believable "Queued, 1 of 1 waiting". This gate is
// what turns that silent forever-wait into an immediate, actionable refusal.

export type FleetAdmissionCode = 'FLEET_UNAVAILABLE' | 'QUEUE_FULL';

export type FleetAdmission =
  | { ok: true }
  | { ok: false; code: FleetAdmissionCode; message: string; queueDepth: number };

export interface FleetAdmissionInput {
  // Connected worker replicas = concurrent execution slots. Null when Redis refuses
  // CLIENT LIST (managed tiers) — unknown capacity, NOT zero capacity.
  workerCount: number | null;
  waiting: number;
  maxQueueDepth: number;
}

export function resolveFleetAdmission({ workerCount, waiting, maxQueueDepth }: FleetAdmissionInput): FleetAdmission {
  // A definite zero means no process can ever claim the job. Refusing beats parking
  // the run in a queue that cannot drain. A null must degrade the check, never block.
  if (workerCount === 0) {
    return {
      ok: false,
      code: 'FLEET_UNAVAILABLE',
      message: 'No test worker is connected to the fleet, so this run cannot start. Please try again once the fleet is back online.',
      queueDepth: waiting,
    };
  }

  // Bounded backlog: one burst would otherwise pin every job payload in Redis and hand
  // later operators a wait no UI can honestly display.
  if (waiting >= maxQueueDepth) {
    return {
      ok: false,
      code: 'QUEUE_FULL',
      message: `The testing fleet is saturated (${waiting} runs already waiting). Please retry shortly.`,
      queueDepth: waiting,
    };
  }

  return { ok: true };
}

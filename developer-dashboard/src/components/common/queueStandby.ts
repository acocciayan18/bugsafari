// Copy for the queued standby chip, kept pure so the wording is unit-testable and the
// component stays a renderer.
//
// The chip used to show the fleet only when activeCount > 0, so a fleet with ZERO
// connected workers rendered as a plain "Queued, 1 of 1 waiting" under a toast promising
// the run would start automatically. Nothing would ever claim it. A definite zero has to
// read as a fault, not as a line that is moving.

export interface QueueStandbyInput {
    position: number | null;
    depth: number;
    activeCount: number;
    workerCount: number | null;
}

export interface QueueStandbyCopy {
    place: string;
    fleet: string | null;
}

export function describeQueueStandby({ position, depth, activeCount, workerCount }: QueueStandbyInput): QueueStandbyCopy {
    // No worker connected: the place in line is meaningless, so say what is actually wrong.
    if (workerCount === 0) {
        return { place: 'no worker connected', fleet: null };
    }

    // depth is the total waiting count, so it is never < position; guard anyway against a
    // push that raced a job leaving the line.
    const place = position !== null
        ? `${position} of ${Math.max(depth, position)} waiting`
        : 'awaiting worker';

    // Capacity is unknown when Redis refuses CLIENT LIST — report only what is true.
    const fleet = activeCount > 0
        ? workerCount && workerCount > 0
            ? `${activeCount} of ${workerCount} running`
            : `${activeCount} running`
        : null;

    return { place, fleet };
}

import { LoaderCircle } from 'lucide-react';
import { useRunStore } from '../../stores/run/runStore';

// Standby indicator — job is waiting for a free worker; all controls locked.
// Shows place in line plus fleet occupancy, so a queue that is moving still reads
// as progress on the ticks where this operator's own position hasn't changed.
export default function QueueStandbyChip() {
    const position = useRunStore((s) => s.queuePosition);
    const depth = useRunStore((s) => s.queueDepth);
    const activeCount = useRunStore((s) => s.queueActiveCount);
    const workerCount = useRunStore((s) => s.queueWorkerCount);

    // depth is the total waiting count, so it is never < position; guard anyway
    // against a push that raced a job leaving the line.
    const place = position !== null
        ? `${position} of ${Math.max(depth, position)} waiting`
        : 'awaiting worker';
    // Capacity is unknown when Redis refuses CLIENT LIST — report only what is true.
    const fleet = activeCount > 0
        ? workerCount && workerCount > 0
            ? `${activeCount} of ${workerCount} running`
            : `${activeCount} running`
        : null;

    return (
        <span
            className="flex min-w-0 items-center gap-2 rounded-lg bg-(--status-neutral-bg) text-(--status-neutral-fg) px-3 py-2 text-xs font-bold uppercase tracking-wide sm:px-4 sm:text-[13px] sm:tracking-wider"
            aria-live="polite"
        >
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin sm:h-5 sm:w-5" strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate">
                Queued — {place}
                {fleet && <span className="font-semibold opacity-80"> · {fleet}</span>}
            </span>
        </span>
    );
}

import { LoaderCircle } from 'lucide-react';
import { useRunStore } from '../../stores/run/runStore';

// Standby indicator — job is waiting for a free worker; all controls locked.
// Selects position/depth itself: the backend has always pushed them, but they had
// no consumer until now.
export default function QueueStandbyChip() {
    const position = useRunStore((s) => s.queuePosition);
    const depth = useRunStore((s) => s.queueDepth);

    const detail = position !== null
        ? `position ${position}${depth > 0 ? ` of ${depth}` : ''}`
        : 'awaiting worker';

    return (
        <span
            className="flex min-w-0 items-center gap-2 rounded-lg bg-(--status-neutral-bg) text-(--status-neutral-fg) px-3 py-2 text-[11px] font-bold uppercase tracking-wide sm:px-4 sm:text-[13px] sm:tracking-wider"
            aria-live="polite"
        >
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin sm:h-5 sm:w-5" strokeWidth={1.75} aria-hidden="true" />
            Queued — {detail}
        </span>
    );
}

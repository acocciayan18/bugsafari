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
            className="flex items-center gap-2 rounded-lg bg-(--status-neutral-bg) text-(--status-neutral-fg) px-4 py-2 text-[13px] font-bold uppercase tracking-wider"
            aria-live="polite"
        >
            <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            Queued — {detail}
        </span>
    );
}

import { useRunStore } from '../../stores/run/runStore';
import SessionTimer from './SessionTimer';

interface SessionTimerLiveProps {
    isRunning?: boolean;
    isPaused?: boolean;
    variant?: 'compact' | 'full';
}

// Selects the timer fields itself so the store tick re-renders only this subtree
// instead of every consumer of the dashboard state object. Pure display of the
// authoritative remainingTimeMs — no independent countdown, no termination trigger.
export default function SessionTimerLive(props: SessionTimerLiveProps) {
    const initialTimeMs = useRunStore((s) => s.activeTimeboxMs);
    const remainingTimeMs = useRunStore((s) => s.remainingTimeMs);

    return <SessionTimer initialTimeMs={initialTimeMs} remainingTimeMs={remainingTimeMs} {...props} />;
}

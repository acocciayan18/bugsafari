import { useRunStore } from '../../stores/run/runStore';
import SessionTimer from './SessionTimer';

interface SessionTimerLiveProps {
    isRunning?: boolean;
    isPaused?: boolean;
    onTimeUp?: () => void;
    variant?: 'compact' | 'full';
}

// Selects the timer fields itself so the 1 Hz tick re-renders only this subtree
// instead of every consumer of the dashboard state object.
export default function SessionTimerLive(props: SessionTimerLiveProps) {
    const initialTimeMs = useRunStore((s) => s.activeTimeboxMs);
    const remainingTimeMs = useRunStore((s) => s.remainingTimeMs);

    return <SessionTimer initialTimeMs={initialTimeMs} remainingTimeMs={remainingTimeMs} {...props} />;
}

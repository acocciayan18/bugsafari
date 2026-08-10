import LiveFeed from './LiveFeed';
import { useRunStore } from '../../stores/run/runStore';
import type { RunTerminationOutcome } from '../../types';

// Everything LiveFeed needs EXCEPT the frame — those two ride an isolated store
// subscription below so a ~30 fps frame stream never re-renders the dashboard.
interface LiveFeedConnectedProps {
  currentUrl?: string;
  targetUrl?: string;
  isConnected?: boolean;
  isTestRunning: boolean;
  isQueued?: boolean;
  hasRunCompleted?: boolean;
  isInitializing?: boolean;
  terminationOutcome?: RunTerminationOutcome | null;
  terminationReason?: string | null;
}

// Subscribes to just the frame slices, so a frame commit re-renders only the
// viewport — the parent dashboard is out of the frame path entirely.
export default function LiveFeedConnected(props: LiveFeedConnectedProps) {
  const liveFrame = useRunStore((s) => s.liveFrame);
  const latestFrame = useRunStore((s) => s.latestFrame);
  return <LiveFeed {...props} frame={latestFrame} liveFrame={liveFrame} />;
}

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useRunStore } from '../../stores/run/runStore';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import { resolveConnectionView } from '../../stores/run/connectionState';

interface ReconnectingBannerProps {
  // The dashboard already resolves whether a run is live; a dropped socket on an idle
  // dashboard is not the high-anxiety case this banner is for.
  active: boolean;
}

// Phases that mean "the live run's link is actually broken", as opposed to a slow or
// degraded-but-connected link (which the lower-left chip already reports quietly).
const BANNER_PHASES = new Set(['recovering', 'disconnected', 'stalled']);

// Persistent inline banner shown above the workspace when the socket drops mid-run.
// Louder and harder to miss than the corner chip, with an explicit Retry — a dropped
// connection mid-run is high-anxiety and the run is still alive on the backend.
export default function ReconnectingBanner({ active }: ReconnectingBannerProps) {
  const isConnected = useRunStore((s) => s.isConnected);
  const isReconnecting = useRunStore((s) => s.isReconnecting);
  const reconnectAttempt = useRunStore((s) => s.reconnectAttempt);
  const reconnectGaveUp = useRunStore((s) => s.reconnectGaveUp);
  const isRestoring = useRunStore((s) => s.isRestoring);
  const engineHealth = useRunStore((s) => s.engineHealth);
  const status = useRunStore((s) => s.status);
  const targetNetworkPhase = useRunStore((s) => s.targetNetworkPhase);

  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const hasConnectedOnce = useRef(false);
  if (isConnected) hasConnectedOnce.current = true;

  const view = resolveConnectionView({
    online,
    isConnected,
    isReconnecting,
    reconnectAttempt,
    reconnectGaveUp,
    isRestoring,
    hasConnectedOnce: hasConnectedOnce.current,
    engineHealth,
    status,
    targetNetworkPhase,
    slowLink: false,
  });

  if (!active || !BANNER_PHASES.has(view.phase)) return null;

  const critical = view.severity === 'critical';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 text-[13px] font-semibold sm:px-4 ${
        critical
          ? 'border-(--status-critical-border) bg-(--status-critical-bg) text-(--status-critical-fg)'
          : 'border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)'
      }`}
    >
      {critical
        ? <WifiOff className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        : <RefreshCw className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.75} aria-hidden="true" />}
      <span className="min-w-0 flex-1">{view.label}</span>
      <span className="text-[12px] font-normal opacity-80">Your run is still active on the server.</span>
      <button
        type="button"
        onClick={() => getEngineGateway().retryConnection()}
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-[12px] font-semibold hover:opacity-80"
      >
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

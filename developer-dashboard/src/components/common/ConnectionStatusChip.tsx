import { useEffect, useRef, useState } from 'react';
import { useRunStore } from '../../stores/run/runStore';
import { toast } from '../../infrastructure/notifications/ToastProvider';

// Top-right network indicator. Surfaces two independent axes: the dashboard↔BugSafari
// link (browser offline / socket reconnecting / reconnect gave up) and the engine's
// reachability of the TARGET app (unstable / auto-paused). Shown only on a state
// change; the socket's initial connecting phase is never treated as a loss, and a
// brief "Connected" flash confirms recovery.
const CONNECTED_FLASH_MS = 2500;

type Severity = 'critical' | 'warning' | 'stable';

interface ChipState {
  label: string;
  severity: Severity;
}

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: 'border-(--status-critical-border) bg-(--status-critical-bg) text-(--status-critical-fg)',
  warning: 'border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)',
  stable: 'border-(--status-stable-border) bg-(--status-stable-bg) text-(--status-stable-fg)',
};

export default function ConnectionStatusChip() {
  const isConnected = useRunStore((s) => s.isConnected);
  const isReconnecting = useRunStore((s) => s.isReconnecting);
  const reconnectAttempt = useRunStore((s) => s.reconnectAttempt);
  const reconnectGaveUp = useRunStore((s) => s.reconnectGaveUp);
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

  // Socket loss only counts once we've actually connected — the initial connecting
  // phase must not flash a loss. True internet loss (navigator) counts always.
  const hasConnectedOnce = useRef(false);
  if (isConnected) hasConnectedOnce.current = true;
  const socketDown = hasConnectedOnce.current && !isConnected;

  // Highest-priority problem wins: link loss masks a target problem (we can't even
  // trust the target signal while the socket is down).
  const problem: ChipState | null = !online
    ? { label: 'No Internet', severity: 'critical' }
    : reconnectGaveUp
      ? { label: 'Connection lost — reload to resume', severity: 'critical' }
      : isReconnecting
        ? { label: `Reconnecting…${reconnectAttempt ? ` (attempt ${reconnectAttempt})` : ''}`, severity: 'warning' }
        : socketDown
          ? { label: 'Connection lost — retrying', severity: 'critical' }
          : targetNetworkPhase === 'PAUSED_NETWORK'
            ? { label: 'Target unreachable — paused, retrying', severity: 'warning' }
            : targetNetworkPhase === 'DEGRADED'
              ? { label: 'Target connection unstable', severity: 'warning' }
              : null;

  const down = problem !== null;

  // "Connected" flash only on a real recovery transition (down → up), never on the
  // initial establishment.
  const wasDown = useRef(down);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    if (down) {
      wasDown.current = true;
      setRecovered(false);
      return;
    }
    if (wasDown.current) {
      wasDown.current = false;
      setRecovered(true);
      const t = setTimeout(() => setRecovered(false), CONNECTED_FLASH_MS);
      return () => clearTimeout(t);
    }
  }, [down]);

  // One-time actionable prompt when auto-reconnect gives up (reload required).
  const gaveUpToasted = useRef(false);
  useEffect(() => {
    if (reconnectGaveUp && !gaveUpToasted.current) {
      gaveUpToasted.current = true;
      toast.network("Connection lost. We couldn't reconnect automatically, so reload the page to resume your session.", { duration: Infinity });
    } else if (!reconnectGaveUp) {
      gaveUpToasted.current = false;
    }
  }, [reconnectGaveUp]);

  if (!down && !recovered) return null;

  const label = problem?.label ?? 'Connected';
  const cls = SEVERITY_CLASS[problem?.severity ?? 'stable'];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-3 top-3 z-9999 flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-[13px] font-semibold shadow-sm backdrop-blur ${cls}`}
    >
      {label}
    </div>
  );
}

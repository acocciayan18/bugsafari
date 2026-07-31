import { useEffect, useRef, useState } from 'react';
import { useRunStore } from '../../stores/run/runStore';
import { toast } from '../../infrastructure/notifications/ToastProvider';

// Top-right network indicator. Two states only — red "No Internet" while the app
// can't reach BugSafari (browser offline OR socket dropped), green "Connected" for
// a brief flash on recovery. Shown only on a state change: never on initial load,
// and the socket's initial connecting phase is not treated as a loss.
const CONNECTED_FLASH_MS = 2500;

export default function ConnectionStatusChip() {
  const isConnected = useRunStore((s) => s.isConnected);
  const reconnectGaveUp = useRunStore((s) => s.reconnectGaveUp);

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
  // phase must not flash "No Internet". True internet loss (navigator) counts always.
  const hasConnectedOnce = useRef(false);
  if (isConnected) hasConnectedOnce.current = true;
  const down = !online || (hasConnectedOnce.current && !isConnected);

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
      toast.network('Connection lost — automatic reconnection failed. Reload the page to resume your session.', { duration: Infinity });
    } else if (!reconnectGaveUp) {
      gaveUpToasted.current = false;
    }
  }, [reconnectGaveUp]);

  if (!down && !recovered) return null;

  const cls = down
    ? 'border-(--status-critical-border) bg-(--status-critical-bg) text-(--status-critical-fg)'
    : 'border-(--status-stable-border) bg-(--status-stable-bg) text-(--status-stable-fg)';
  const dot = down ? 'bg-(--status-critical-fg)' : 'bg-(--status-stable-fg)';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-3 top-3 z-9999 flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold shadow-sm backdrop-blur ${cls}`}
    >
      
      {down ? 'No Internet' : 'Connected'}
    </div>
  );
}

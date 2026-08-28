import { useEffect, useRef, useState } from 'react';
import { useRunStore } from '../../stores/run/runStore';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import { getEngineGateway } from '../../infrastructure/engine/engineGateway';
import { resolveConnectionView, type ConnectionSeverity } from '../../stores/run/connectionState';

// Top-right status indicator. Single host for every connection state the operator needs
// to distinguish: Connected, Recovering, Disconnected, Stalled, Stopped. The decision
// itself lives in resolveConnectionView so it is testable without React; this component
// only owns the browser-only inputs (navigator, Network Information API) and rendering.
//
// A healthy link shows a quiet Connected pill rather than nothing, so "no chip" can
// never be mistaken for "connected" — the ambiguity that made a dead stream invisible.
const CONNECTED_FLASH_MS = 2500;

const SEVERITY_CLASS: Record<ConnectionSeverity, string> = {
  critical: 'border-(--status-critical-border) bg-(--status-critical-bg) text-(--status-critical-fg)',
  warning: 'border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)',
  stable: 'border-(--status-stable-border) bg-(--status-stable-bg) text-(--status-stable-fg)',
};

export default function ConnectionStatusChip() {
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

  // Proactive slow-link detection via the Network Information API (Chromium/Android).
  // Passive — one change listener, zero cost on fast links. Where the API is absent
  // (Safari/Firefox) slowLink stays false and only the reactive states below apply.
  const [slowLink, setSlowLink] = useState(false);
  useEffect(() => {
    const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void } }).connection;
    if (!conn?.addEventListener) return;
    const read = () => setSlowLink(conn.saveData === true || conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g');
    read();
    conn.addEventListener('change', read);
    return () => conn.removeEventListener?.('change', read);
  }, []);

  // One-time notice on slow-link onset — the copy the operator needs before blaming
  // the tool for lagging frames. Re-arms once the link recovers.
  const slowToasted = useRef(false);
  useEffect(() => {
    if (slowLink && !slowToasted.current) {
      slowToasted.current = true;
      toast.network('Slow internet connection may affect test execution and live updates.', { duration: 6000 });
    } else if (!slowLink) {
      slowToasted.current = false;
    }
  }, [slowLink]);

  // Socket loss only counts once we've actually connected — the initial connecting
  // phase must not flash a loss. True internet loss (navigator) counts always.
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
    slowLink,
  });

  const down = view.severity !== 'stable';

  // Emphasise the chip briefly after a real recovery (down → up), then settle back to
  // the quiet Connected pill.
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

  // One-time actionable prompt when auto-reconnect gives up. Retry is now in-page: the
  // socket re-arms on `online`/tab-focus too, so a full reload is a last resort, not the
  // only way back to a run that is still alive on the backend.
  const gaveUpToasted = useRef(false);
  useEffect(() => {
    if (reconnectGaveUp && !gaveUpToasted.current) {
      gaveUpToasted.current = true;
      toast.network("Connection lost. Your session is still running — press Retry to reconnect.", { duration: Infinity });
    } else if (!reconnectGaveUp) {
      gaveUpToasted.current = false;
    }
  }, [reconnectGaveUp]);

  // Quiet when healthy and uneventful: a persistent pill, but visually recessive.
  const quiet = !down && !recovered;

  return (
    <div
      role="status"
      aria-live="polite"
      data-connection-phase={view.phase}
      className={`fixed right-3 top-3 z-9999 flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-[13px] font-semibold shadow-sm backdrop-blur transition-opacity ${SEVERITY_CLASS[view.severity]} ${quiet ? 'opacity-60' : 'opacity-100'}`}
    >
      {view.label}
      {reconnectGaveUp && (
        <button
          type="button"
          onClick={() => getEngineGateway().retryConnection()}
          className="ml-1 rounded-[6px] border border-current px-2 py-0.5 text-[12px] font-semibold hover:opacity-80"
        >
          Retry
        </button>
      )}
    </div>
  );
}

import type { ReactNode } from 'react';

interface ConnectionStatusOverlayProps {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  isRestoring: boolean;
}

// Global, non-modal status banners for the connection failure modes that recovery
// must make visible: backend disconnect, reconnection-in-progress, and session
// restore. Stacked top-center; pointer-events limited to the banners so the
// dashboard underneath stays interactive.
export default function ConnectionStatusOverlay({
  isConnected,
  isReconnecting,
  reconnectAttempt,
  isRestoring,
}: ConnectionStatusOverlayProps) {
  // Backend link is down and not actively retrying (initial loss).
  const backendDown = !isConnected && !isReconnecting;

  if (!backendDown && !isReconnecting && !isRestoring) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex flex-col items-center gap-2 p-3">
      {backendDown && (
        <Banner tone="danger">
          <Dot className="bg-red-200" />
          <span>Connection to BugSafari lost. Attempting to restore…</span>
        </Banner>
      )}

      {isReconnecting && (
        <Banner tone="warning">
          <Spinner />
          <span>Reconnecting to BugSafari{reconnectAttempt > 0 ? ` — attempt ${reconnectAttempt}` : '…'}</span>
        </Banner>
      )}

      {isRestoring && !backendDown && (
        <Banner tone="info">
          <Spinner />
          <span>Restoring your active session…</span>
        </Banner>
      )}
    </div>
  );
}

type Tone = 'danger' | 'warning' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  danger: 'bg-red-600 text-white ring-red-700/40',
  warning: 'bg-amber-500 text-black ring-amber-600/40',
  info: 'bg-slate-800 text-white ring-slate-900/40 dark:bg-slate-700',
};

function Banner({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ring-1 ${TONE_CLASSES[tone]}`}
    >
      {children}
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block h-2 w-2 animate-pulse rounded-full ${className}`} />;
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
      aria-hidden="true"
    />
  );
}

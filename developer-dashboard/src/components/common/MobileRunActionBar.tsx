import { BugPlay, Square, Check } from 'lucide-react';

export type MobileRunAction = 'start' | 'stop' | 'cancel' | 'save' | null;

interface MobileRunActionBarProps {
  action: MobileRunAction;
  disabled?: boolean;
  onStart: () => void;
  onStopRequest: () => void;
  onCancelQueued: () => void;
  onSave: () => void;
}

// Pinned primary action within thumb reach on phones (< lg). The top control row keeps
// Config + URL; the single most-relevant run action (Start / Stop / Cancel / Save) drops
// here so it never scrolls out of reach mid-run. Desktop keeps the top controls (hidden
// here via lg:hidden). Presentational — the dashboard decides which action applies.
export default function MobileRunActionBar({
  action,
  disabled = false,
  onStart,
  onStopRequest,
  onCancelQueued,
  onSave,
}: MobileRunActionBarProps) {
  if (!action) return null;

  const base =
    'flex h-12 w-full items-center justify-center gap-2 rounded-lg px-5 text-[13px] font-semibold uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--border-hairline) bg-(--surface-panel)/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      {action === 'start' && (
        <button type="button" onClick={onStart} disabled={disabled} className={`${base} bg-(--surface-invert) text-(--text-oninvert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active)`}>
          <BugPlay className="h-5 w-5 shrink-0" aria-hidden="true" />
          Start Testing
        </button>
      )}
      {action === 'stop' && (
        <button type="button" onClick={onStopRequest} className={`${base} bg-(--status-critical-fg) text-(--text-oninvert) hover:opacity-90`}>
          <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Stop
        </button>
      )}
      {action === 'cancel' && (
        <button type="button" onClick={onCancelQueued} className={`${base} bg-(--status-critical-fg) text-(--text-oninvert) hover:opacity-90`}>
          <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Cancel Queued Run
        </button>
      )}
      {action === 'save' && (
        <button type="button" onClick={onSave} disabled={disabled} className={`${base} border border-(--border-default) text-(--text-primary) hover:bg-(--surface-hover)`}>
          {disabled && <Check className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
          {disabled ? 'Saved' : 'Save Session'}
        </button>
      )}
    </div>
  );
}

import { BugPlay, Square, Check } from 'lucide-react';

export type MobileSessionPhase = 'idle' | 'queued' | 'active' | 'completed' | 'transition';

interface MobileRunActionBarProps {
  session: MobileSessionPhase;
  startDisabled?: boolean;
  saveDisabled?: boolean;
  onStart: () => void;
  onStopRequest: () => void;
  onCancelQueued: () => void;
  onSave: () => void;
}

const BTN =
  'flex h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-semibold uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

// Pinned run controls within thumb reach on phones (< lg). The top control row keeps
// Config + URL; the run action(s) relevant to the CURRENT session phase live here so
// they never scroll out of reach. Desktop keeps the top controls (lg:hidden here).
// A settling transition renders nothing — controls are locked until it resolves.
export default function MobileRunActionBar({
  session,
  startDisabled = false,
  saveDisabled = false,
  onStart,
  onStopRequest,
  onCancelQueued,
  onSave,
}: MobileRunActionBarProps) {
  if (session === 'transition') return null;

  const startBtn = (
    <button type="button" onClick={onStart} disabled={startDisabled} className={`${BTN} bg-(--surface-invert) text-(--text-oninvert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active)`}>
      <BugPlay className="h-5 w-5 shrink-0" aria-hidden="true" />
      {/* "New test" after a finished run reads clearer than a bare "Start". */}
      {session === 'completed' ? 'New Test' : 'Start Testing'}
    </button>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-(--border-hairline) bg-(--surface-panel)/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      {session === 'idle' && startBtn}

      {session === 'active' && (
        <button type="button" onClick={onStopRequest} className={`${BTN} bg-(--status-critical-fg) text-(--text-oninvert) hover:opacity-90`}>
          <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Stop
        </button>
      )}

      {session === 'queued' && (
        <button type="button" onClick={onCancelQueued} className={`${BTN} bg-(--status-critical-fg) text-(--text-oninvert) hover:opacity-90`}>
          <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Cancel Queued Run
        </button>
      )}

      {/* Finished run: Save the result AND start the next test — Start never vanishes
          just because Save is available. */}
      {session === 'completed' && (
        <>
          <button type="button" onClick={onSave} disabled={saveDisabled} className={`${BTN} border border-(--border-strong) text-(--text-primary) hover:bg-(--surface-hover)`}>
            {saveDisabled && <Check className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
            {saveDisabled ? 'Saved' : 'Save'}
          </button>
          {startBtn}
        </>
      )}
    </div>
  );
}

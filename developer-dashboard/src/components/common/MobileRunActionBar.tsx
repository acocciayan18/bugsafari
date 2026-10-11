import { BugPlay, Square, Check } from 'lucide-react';
import { Button } from '../ui/Button';

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

// Bar-specific layout on top of the Button primitive: full-width thumb targets, dense uppercase label.
const BAR_BTN = 'h-12 flex-1 px-4 text-[13px] font-semibold uppercase';

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
    <Button variant="primary" size="lg" onClick={onStart} disabled={startDisabled} className={BAR_BTN}>
      <BugPlay className="h-5 w-5 shrink-0" aria-hidden="true" />
      {/* "New test" after a finished run reads clearer than a bare "Start". */}
      {session === 'completed' ? 'New Test' : 'Start Testing'}
    </Button>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-(--border-hairline) bg-(--surface-panel)/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      {session === 'idle' && startBtn}

      {session === 'active' && (
        <Button variant="destructive" size="lg" onClick={onStopRequest} className={BAR_BTN}>
          <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Stop
        </Button>
      )}

      {session === 'queued' && (
        <Button variant="destructive" size="lg" onClick={onCancelQueued} className={BAR_BTN}>
          <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          Cancel Queued Run
        </Button>
      )}

      {/* Finished run: Save the result AND start the next test — Start never vanishes
          just because Save is available. */}
      {session === 'completed' && (
        <>
          <Button variant="secondary" size="lg" onClick={onSave} disabled={saveDisabled} className={BAR_BTN}>
            {saveDisabled && <Check className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
            {saveDisabled ? 'Saved' : 'Save'}
          </Button>
          {startBtn}
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { useRunStore } from '../../stores/run/runStore';

// A Pause/Stop that settles under this stays silent; only genuinely slow ones
// surface the reassurance card, so a near-instant transition creates no UI noise.
export const LONG_OP_CARD_DELAY_MS = 10000;

type LongOp = 'pause' | 'stop';

// Only PAUSING / STOPPING are in-flight control transitions; anything else clears it.
function opFromStatus(status: string): LongOp | null {
  if (status === 'PAUSING') return 'pause';
  if (status === 'STOPPING') return 'stop';
  return null;
}

// One accurate cause, shown at random, for why the settle is taking a while.
const COPY: Record<LongOp, { title: string; reasons: string[] }> = {
  pause: {
    title: 'Pausing session',
    reasons: [
      'Finishing the current browser action before it can pause',
      'A slow network connection is delaying the current request',
      'Saving the latest findings and telemetry',
    ],
  },
  stop: {
    title: 'Finalizing session',
    reasons: [
      'Finishing the current browser action before it can stop',
      'A slow network connection is delaying the current request',
      'Saving the latest findings and telemetry',
      'Cleaning up Playwright / browser resources',
    ],
  },
};

function pickReason(op: LongOp): string {
  const { reasons } = COPY[op];
  return reasons[Math.floor(Math.random() * reasons.length)];
}

// Non-blocking corner card for a slow Pause/Stop. Duplicate requests are already
// blocked upstream (runCommands optimistic lock + disabled controls), and a single
// mounted instance with one visibleOp guarantees at most one card per operation.
// Auto-hides the instant the transition settles — success (PAUSED/IDLE) or failure
// (any terminal) both clear the op — or when the operator dismisses it.
export default function LongOperationProgressCard() {
  const status = useRunStore((s) => s.status);
  const op = opFromStatus(status);

  const [visibleOp, setVisibleOp] = useState<LongOp | null>(null);
  const [reason, setReason] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!op) {
      clearTimeout(timer.current);
      setVisibleOp(null);
      setDismissed(false);
      return;
    }
    // Arm once per transition; reveal with a single random reason only if still
    // settling past the threshold.
    timer.current = setTimeout(() => {
      setReason(pickReason(op));
      setVisibleOp(op);
    }, LONG_OP_CARD_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [op]);

  if (!visibleOp || dismissed) return null;

  const { title } = COPY[visibleOp];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 right-3 z-9999 w-[min(20rem,calc(100vw-1.5rem))] rounded-[10px] border border-(--border-strong) bg-(--surface-panel) p-4 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-(--status-stable-fg)" strokeWidth={2} aria-hidden="true" />
        <span className="text-[13px] font-bold text-(--text-primary)">{title}…</span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="ml-auto -mr-1 rounded p-0.5 text-(--text-tertiary) hover:text-(--text-primary)"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2.5 text-xs text-(--text-secondary)">{reason}.</p>
      <p className="mt-2.5 text-xs font-medium text-(--text-tertiary)">
        This delay is expected — please wait while BugSafari finishes. You can keep using the dashboard.
      </p>
    </div>
  );
}

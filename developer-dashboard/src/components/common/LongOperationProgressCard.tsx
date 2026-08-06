import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useRunStore } from '../../stores/run/runStore';

// How long a Pause/Stop may settle before we reassure the operator it is still
// working. Short transitions finish silently; only genuinely long ones surface.
export const LONG_OP_MODAL_DELAY_MS = 15000;

type LongOp = 'pause' | 'stop';

// Only PAUSING / STOPPING are in-flight control transitions; anything else clears it.
function opFromStatus(status: string): LongOp | null {
  if (status === 'PAUSING') return 'pause';
  if (status === 'STOPPING') return 'stop';
  return null;
}

const COPY: Record<LongOp, { title: string; reasons: string[] }> = {
  pause: {
    title: 'Pausing session',
    reasons: [
      'Waiting for the current browser action to finish',
      'Saving telemetry and findings',
      'Pausing the exploration engine',
    ],
  },
  stop: {
    title: 'Finalizing session',
    reasons: [
      'Waiting for the current browser action to finish',
      'Saving telemetry and findings',
      'Cleaning up Playwright / browser resources',
      'Finalizing the testing session',
    ],
  },
};

// Non-blocking corner card for long-running Pause/Stop. Duplicate requests are
// already blocked upstream (runCommands optimistic lock + disabled controls), so
// this is purely reassurance. Auto-hides the instant the transition settles —
// success (PAUSED/IDLE) or failure (any terminal) both clear the op.
export default function LongOperationProgressCard() {
  const status = useRunStore((s) => s.status);
  const op = opFromStatus(status);

  const [visibleOp, setVisibleOp] = useState<LongOp | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!op) {
      clearTimeout(timer.current);
      setVisibleOp(null);
      return;
    }
    // Arm once per transition; reveal only if still settling past the threshold.
    timer.current = setTimeout(() => setVisibleOp(op), LONG_OP_MODAL_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [op]);

  if (!visibleOp) return null;

  const { title, reasons } = COPY[visibleOp];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 right-3 z-9999 w-[min(20rem,calc(100vw-1.5rem))] rounded-[10px] border border-(--border-strong) bg-(--surface-panel) p-4 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-(--status-stable-fg)" strokeWidth={2} aria-hidden="true" />
        <span className="text-[13px] font-bold text-(--text-primary)">{title}…</span>
      </div>
      <ul className="mt-2.5 space-y-1">
        {reasons.map((reason) => (
          <li key={reason} className="flex gap-1.5 text-xs text-(--text-secondary)">
            <span className="text-(--text-tertiary)" aria-hidden="true">•</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs font-medium text-(--text-tertiary)">
        Still working — this can take a moment. You can keep using the dashboard.
      </p>
    </div>
  );
}

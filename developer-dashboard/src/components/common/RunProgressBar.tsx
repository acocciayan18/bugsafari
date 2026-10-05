import { useRunStore } from '../../stores/run/runStore';

// Fraction of the budget left at which the bar flips amber — the run is "nearly up".
const AMBER_THRESHOLD = 0.15;

function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const m = Math.floor(clamped / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Determinate elapsed/total bar tied to the run's duration cap, beside the countdown.
// The timer alone shows time left but never how close the run is to its budget, so the
// ending reads as abrupt. Pure display of the store's authoritative time — no own clock.
export default function RunProgressBar() {
  const total = useRunStore((s) => s.activeTimeboxMs);
  const remaining = useRunStore((s) => s.remainingTimeMs);

  if (!total) return null;
  const elapsed = Math.min(total, Math.max(0, total - remaining));
  const fraction = total > 0 ? elapsed / total : 0;
  const nearlyUp = remaining <= total * AMBER_THRESHOLD;

  return (
    <div className="flex min-w-[120px] flex-1 items-center gap-2 sm:max-w-[200px]">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--surface-inset)"
        role="progressbar"
        aria-label="Run progress"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(elapsed / 1000)}
        aria-valuetext={`${formatClock(elapsed)} of ${formatClock(total)} elapsed`}
      >
        <div
          className={`h-full rounded-full transition-all duration-1000 ${nearlyUp ? 'bg-(--status-warning-fg)' : 'bg-(--status-stable-fg)'}`}
          style={{ width: `${(fraction * 100).toFixed(1)}%` }}
        />
      </div>
      <span className={`shrink-0 font-mono text-[12px] tabular-nums ${nearlyUp ? 'text-(--status-warning-fg)' : 'text-(--text-tertiary)'}`}>
        {formatClock(elapsed)} / {formatClock(total)}
      </span>
    </div>
  );
}

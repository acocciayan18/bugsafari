import type { RunTerminationOutcome } from '../../types';
import { TERMINATION_COPY, isCleanTermination } from '../../types';

// Legacy rows persisted before the taxonomy existed carry only a coarse status.
// Keys are normalized (uppercase, alpha-only) because the same state reaches the
// UI as both a DB SessionStatus ('TimedOut') and a view status ('TIMEOUT').
const STATUS_FALLBACK: Record<string, RunTerminationOutcome> = {
  COMPLETED: 'completed',
  CRASHED: 'exception',
  HALTED: 'graceful-shutdown',
  STOPPED: 'user-stopped',
  TIMEOUT: 'timebox',
  TIMEDOUT: 'timebox',
  ABANDONED: 'abandoned',
  ENGINEERROR: 'engine-error',
};

/** Resolve a coarse status of either casing to its termination outcome, or null. */
export function outcomeFromStatus(status?: string): RunTerminationOutcome | null {
  if (!status) return null;
  return STATUS_FALLBACK[status.replace(/[^a-zA-Z]/g, '').toUpperCase()] ?? null;
}

interface TerminationBadgeProps {
  outcome?: RunTerminationOutcome;
  /** Coarse status used only when `outcome` is absent. */
  status?: string;
  /** Engine-supplied detail, surfaced as the tooltip. */
  reason?: string;
  /** 'mono' forces a neutral black/white badge, dropping status color. */
  variant?: 'default' | 'mono';
  className?: string;
}

// Every surface renders the termination through this component, so Telemetry,
// Live Feed, History, and Reports can never disagree about why a run ended.
export function TerminationBadge({ outcome, status, reason, variant = 'default', className = '' }: TerminationBadgeProps) {
  const resolved = outcome ?? outcomeFromStatus(status);
  if (!resolved) return null;

  const copy = TERMINATION_COPY[resolved];
  const tone = variant === 'mono'
    ? 'border-[var(--border-hairline)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
    : isCleanTermination(resolved)
      ? 'border-[var(--status-stable-border)] text-[var(--status-stable-fg)]'
      : resolved === 'graceful-shutdown' || resolved === 'abandoned' || resolved === 'engine-error'
        ? 'border-[var(--status-warning-border)] text-[var(--status-warning-fg)]'
        : 'border-[var(--status-critical-border)] text-[var(--status-critical-fg)]';

  return (
    <span
      className={`inline-flex min-h-6 items-center truncate rounded border border-[var(--border-hairline)] bg-[var(--surface-inset)] px-2 py-0.5 font-mono text-[var(--text-secondary)] ${tone} ${className}`}
      title={reason || copy.detail}
    >
      <span className="shrink-0" aria-hidden="true">{copy.icon}</span>
      <span className="min-w-0 truncate">{copy.label}</span>
    </span>
  );
}

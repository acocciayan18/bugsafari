import { useRunStore } from '../../stores/run/runStore';
import type { RunTerminationOutcome } from '../../types';
import { TerminationBadge } from './TerminationBadge';

interface RunCompletionStatusProps {
  outcome?: RunTerminationOutcome | null;
  reason?: string | null;
}

// MM:SS from a millisecond span.
function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Terminal status shown in the command bar once a run finishes: the completion
// state leads, elapsed time is secondary metadata (never the headline).
export default function RunCompletionStatus({ outcome, reason }: RunCompletionStatusProps) {
  const timeboxMs = useRunStore((s) => s.activeTimeboxMs);
  const remainingMs = useRunStore((s) => s.remainingTimeMs);
  const elapsedMs = Math.max(0, timeboxMs - remainingMs);

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <TerminationBadge outcome={outcome ?? undefined} reason={reason ?? undefined} status="COMPLETED" />
      <span className="font-mono text-xs text-(--text-tertiary) sm:text-[13px]">
        Elapsed {formatClock(elapsedMs)}
      </span>
    </div>
  );
}

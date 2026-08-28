import { useMemo } from 'react';
import { Terminal } from 'lucide-react';
import type { BrowserConsoleMessage } from '../../types';
import ConsoleMessageList from '../common/ConsoleMessageCard';
import EmptyState from '../common/EmptyState';

const FILTERS = ['all', 'error', 'warning', 'info', 'debug', 'log'] as const;
export type ConsoleFilter = (typeof FILTERS)[number];

interface ConsoleFilterBarProps {
  browserConsole: BrowserConsoleMessage[];
  filter: ConsoleFilter;
  onFilterChange: (filter: ConsoleFilter) => void;
}

// Rendered by the terminal header, not inside the scroll body — it belongs to the
// fixed chrome under the tab strip, so no sticky offset or padding cancellation is needed.
export function ConsoleFilterBar({ browserConsole = [], filter, onFilterChange }: ConsoleFilterBarProps) {
  const counts = useMemo(() => {
    const tally: Partial<Record<ConsoleFilter, number>> = { all: browserConsole.length };
    for (const log of browserConsole) {
      const key = log.level as ConsoleFilter;
      if (FILTERS.includes(key)) tally[key] = (tally[key] ?? 0) + 1;
    }
    return tally;
  }, [browserConsole]);

  return (
    <div
      role="group"
      aria-label="Console severity filters"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-(--border-hairline) bg-(--surface-panel) px-3 py-2 sm:px-4"
    >
      {FILTERS.map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => onFilterChange(level)}
          aria-pressed={filter === level}
          className={`px-2 py-1.5 cursor-pointer sm:py-0.5 rounded text-xs font-bold uppercase  transition-colors ${
            filter === level
              ? 'bg-(--surface-inset) text-(--text-primary)'
              : 'text-(--text-tertiary) hover:text-(--text-secondary)'
          }`}
        >
          {level}
          {counts[level] ? <span className="ml-1 opacity-60">{counts[level]}</span> : null}
        </button>
      ))}
    </div>
  );
}

interface ConsoleTabPanelProps {
  browserConsole: BrowserConsoleMessage[];
  filter: ConsoleFilter;
}

// Card list of captured console messages. The parent tab body owns scrolling and
// the jump-to-bottom affordance, so this panel adds no container of its own.
export default function ConsoleTabPanel({ browserConsole = [], filter }: ConsoleTabPanelProps) {
  const visible = useMemo(
    () => (filter === 'all' ? browserConsole : browserConsole.filter((log) => log.level === filter)),
    [browserConsole, filter],
  );

  if (visible.length === 0) {
    if (browserConsole.length === 0) {
      return (
        <EmptyState
          Icon={Terminal}
          tone="ready"
          title="Console ready"
          description="Listening for the target app's console output. Logs, warnings and errors stream in here."
        />
      );
    }
    return <div className="px-1 py-6 text-center text-[13px] text-(--text-tertiary)">{`No ${filter} logs in this session.`}</div>;
  }

  return <ConsoleMessageList logs={visible} />;
}

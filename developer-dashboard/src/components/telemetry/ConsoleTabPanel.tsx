import { useMemo, useState } from 'react';
import type { BrowserConsoleLevel, BrowserConsoleMessage } from '../../types';
import { CopyButton } from '../common/ForensicCardKit';

// Per-level accent so severity reads at a glance in a dense list.
const LEVEL_STYLES: Record<BrowserConsoleLevel, string> = {
  error: 'text-(--status-critical-fg)',
  warning: 'text-(--status-warning-fg)',
  info: 'text-(--status-neutral-fg)',
  notice: 'text-(--status-stable-fg)',
  debug: 'text-(--text-secondary)',
  trace: 'text-(--text-tertiary)',
  log: 'text-(--text-tertiary)',
};

// Error and warning rows get a tinted gutter so they stay findable while scrolling.
const ROW_ACCENTS: Partial<Record<BrowserConsoleLevel, string>> = {
  error: 'border-l-2 border-l-(--status-critical-fg) bg-(--status-critical-bg)/25',
  warning: 'border-l-2 border-l-(--status-warning-fg) bg-(--status-warning-bg)/25',
};

const FILTERS = ['all', 'error', 'warning', 'info', 'debug', 'log'] as const;
type Filter = (typeof FILTERS)[number];

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return `${date.toLocaleTimeString('en-GB', { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

interface ConsoleTabPanelProps {
  browserConsole: BrowserConsoleMessage[];
}

// Flat, high-density log list. The parent tab body owns scrolling and the
// jump-to-bottom affordance, so this panel adds no container of its own.
export default function ConsoleTabPanel({ browserConsole = [] }: ConsoleTabPanelProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(
    () => (filter === 'all' ? browserConsole : browserConsole.filter((log) => log.level === filter)),
    [browserConsole, filter],
  );

  const counts = useMemo(() => {
    const tally: Partial<Record<Filter, number>> = { all: browserConsole.length };
    for (const log of browserConsole) {
      const key = log.level as Filter;
      if (FILTERS.includes(key)) tally[key] = (tally[key] ?? 0) + 1;
    }
    return tally;
  }, [browserConsole]);

  return (
    <div className="-mx-3 -mt-3 sm:-mx-4 sm:-mt-4">
    <div className="sticky top-0 z-10 -mt-3 -mx-3 sm:-mt-4 sm:-mx-4 flex flex-wrap items-center gap-1.5 px-3 py-2 sm:px-4 mb-1 bg-(--surface-panel) border-b border-(--border-hairline)">{FILTERS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setFilter(level)}
            aria-pressed={filter === level}
            className={`px-2 py-1.5 sm:py-0.5 rounded text-[11px] font-bold uppercase tracking-wide transition-colors ${
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

      {visible.length === 0 ? (
        <div className="text-(--text-tertiary) italic text-[13px] py-6 px-3">
          {browserConsole.length === 0 ? 'No browser console logs captured yet.' : `No ${filter} logs in this session.`}
        </div>
      ) : (
        <div className="leading-5 pb-6">
          {visible.map((log, idx) => (
            <div
              key={`${log.timestamp}-${idx}`}
              className={`group grid grid-cols-[1fr_auto] items-baseline gap-x-2 px-3 py-1.5 border-b border-(--border-hairline)/40 hover:bg-(--surface-hover) lg:grid-cols-[7.5rem_3.5rem_1fr_auto] lg:gap-x-3 lg:py-1 ${ROW_ACCENTS[log.level] ?? ''}`}
            >
              {/* Timestamp + level share one row on narrow panes, split into their own columns once there's room. */}
              <div className="flex min-w-0 items-baseline gap-2 lg:contents">
                <span className="text-(--text-tertiary) tabular-nums whitespace-nowrap">{formatTime(log.timestamp)}</span>
                <span className={`uppercase font-bold truncate ${LEVEL_STYLES[log.level] ?? LEVEL_STYLES.log}`}>
                  {log.level}
                </span>
              </div>
              <span className="col-span-2 min-w-0 whitespace-pre-wrap break-words text-(--text-primary) lg:col-span-1">
                {log.message}
                {(log.url || log.line) && (
                  <span className="ml-2 text-(--text-tertiary)">
                    {log.url}{log.line ? `:${log.line}` : ''}{log.column ? `:${log.column}` : ''}
                  </span>
                )}
                {log.stackTrace && (
                  <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-4 text-(--text-tertiary) border-l-2 border-(--border-hairline) pl-2">
                    {log.stackTrace}
                  </pre>
                )}
              </span>
              {/* Hover-reveal has no touch equivalent, so the button stays visible on narrow/coarse panes. */}
              <span className="col-start-2 row-start-1 justify-self-end transition-opacity group-focus-within:opacity-100 lg:col-start-auto lg:row-start-auto lg:opacity-0 lg:group-hover:opacity-100">
                <CopyButton text={log.message} label="Log" />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

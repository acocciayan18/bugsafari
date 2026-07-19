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
    <div className="-m-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 px-2 py-1.5 bg-(--surface-panel) border-b border-(--border-hairline)">
        {FILTERS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setFilter(level)}
            aria-pressed={filter === level}
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
              filter === level
                ? 'bg-(--surface-inset) text-(--text-primary)'
                : 'text-(--text-tertiary) hover:text-(--text-secondary)'
            }`}
          >
            {level}
            {counts[level] ? <span className="ml-1 opacity-60">{counts[level]}</span> : null}
          </button>
        ))}
        <div className="ml-auto">
          <CopyButton text={JSON.stringify(browserConsole, null, 2)} label="All logs" />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-(--text-tertiary) italic text-xs py-4 px-3">
          {browserConsole.length === 0 ? 'No browser console logs captured yet.' : `No ${filter} logs in this session.`}
        </div>
      ) : (
        <div className="leading-5">
          {visible.map((log, idx) => (
            <div
              key={`${log.timestamp}-${idx}`}
              className={`group grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-x-2 px-2 py-0.5 border-b border-(--border-hairline)/40 hover:bg-(--surface-hover) ${ROW_ACCENTS[log.level] ?? ''}`}
            >
              <span className="text-(--text-tertiary) tabular-nums">{formatTime(log.timestamp)}</span>
              <span className={`uppercase font-bold w-14 shrink-0 ${LEVEL_STYLES[log.level] ?? LEVEL_STYLES.log}`}>
                {log.level}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words text-(--text-primary)">
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
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                <CopyButton text={log.message} label="Log" />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shared console-message card + list — the ONE renderer used by the live Console
// tab (ConsoleTabPanel) and the saved Forensic Report. BrowserConsoleMessage and
// ForensicConsoleLog are structurally identical, so both tabs feed this directly
// and can never drift in level styling, badges, timestamps or expand behavior.

import { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, Bug, Terminal, Activity, ChevronDown, Link2 } from 'lucide-react';
import type { BrowserConsoleLevel, BrowserConsoleMessage } from '../../types';
import { CopyButton } from './ForensicCardKit';
import { formatLogTimestamp } from '../../utils/datetime';

// Per-level presentation: icon + label + tone classes so severity reads at a glance.
interface LevelStyle {
  label: string;
  icon: typeof AlertCircle;
  accent: string;
  badge: string;
  card: string;
}

const LEVEL_STYLES: Record<BrowserConsoleLevel, LevelStyle> = {
  error: {
    label: 'Error',
    icon: AlertCircle,
    accent: 'border-l-(--status-critical-fg)',
    badge: 'border-(--status-critical-border) text-(--status-critical-fg) bg-(--status-critical-bg)/30',
    card: 'bg-(--status-critical-bg)/10',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    accent: 'border-l-(--status-warning-fg)',
    badge: 'border-(--status-warning-border) text-(--status-warning-fg) bg-(--status-warning-bg)/30',
    card: 'bg-(--status-warning-bg)/10',
  },
  info: {
    label: 'Info',
    icon: Info,
    accent: 'border-l-(--status-neutral-fg)',
    badge: 'border-(--status-neutral-border) text-(--status-neutral-fg) bg-(--status-neutral-bg)/25',
    card: '',
  },
  notice: {
    label: 'Notice',
    icon: Info,
    accent: 'border-l-(--status-stable-fg)',
    badge: 'border-(--status-stable-border) text-(--status-stable-fg) bg-(--status-stable-bg)/25',
    card: '',
  },
  debug: {
    label: 'Debug',
    icon: Bug,
    accent: 'border-l-(--text-secondary)',
    badge: 'border-(--border-hairline) text-(--text-secondary)',
    card: '',
  },
  trace: {
    label: 'Trace',
    icon: Activity,
    accent: 'border-l-(--text-tertiary)',
    badge: 'border-(--border-hairline) text-(--text-tertiary)',
    card: '',
  },
  log: {
    label: 'Log',
    icon: Terminal,
    accent: 'border-l-(--border-hairline)',
    badge: 'border-(--border-hairline) text-(--text-tertiary)',
    card: '',
  },
};

// Long messages collapse to keep the list scannable; expand reveals the rest.
const CLAMP_THRESHOLD = 220;

// Millisecond precision moves to the row tooltip — it only matters when two logs
// land inside the same second, which is not worth the width in every row.
function preciseTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${date.toLocaleTimeString('en-GB', { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

// Source location string from the message's url/line/column, when present.
function sourceLabel(log: BrowserConsoleMessage): string | null {
  if (!log.url) return null;
  return `${log.url}${log.line ? `:${log.line}` : ''}${log.column ? `:${log.column}` : ''}`;
}

// One console message as a self-contained card. Owns its own expand state so a
// long message or a stack trace can open without touching sibling cards.
export function ConsoleCard({ log }: { log: BrowserConsoleMessage }) {
  const style = LEVEL_STYLES[log.level] ?? LEVEL_STYLES.log;
  const Icon = style.icon;
  const source = sourceLabel(log);
  const isLong = log.message.length > CLAMP_THRESHOLD || log.message.includes('\n');
  const [messageOpen, setMessageOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);

  return (
    <div
      className={`group rounded-lg border border-(--border-hairline) border-l-2 ${style.accent} ${style.card} px-3 py-2.5 transition-colors hover:bg-(--surface-hover)`}
    >
      {/* Header: severity badge + timestamp + hover-reveal copy. */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${style.badge}`}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {style.label}
        </span>
        {log.type && log.type !== log.level && (
          <span className="truncate text-xs font-medium text-(--text-tertiary)">{log.type}</span>
        )}
        <span
          title={preciseTime(log.timestamp)}
          className="ml-auto shrink-0 tabular-nums text-xs text-(--text-tertiary)"
        >
          {formatLogTimestamp(log.timestamp)}
        </span>
        <span className="shrink-0 transition-opacity group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <CopyButton text={log.message} label="Log" />
        </span>
      </div>

      {/* Message body — clamped when long, toggled open on demand. */}
      <p
        className={`mt-2 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-(--text-primary) ${
          isLong && !messageOpen ? 'line-clamp-3' : ''
        }`}
      >
        {log.message}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setMessageOpen((v) => !v)}
          aria-expanded={messageOpen}
          className="mt-1 cursor-pointer text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary)"
        >
          {messageOpen ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Source location, when the message carries a url. */}
      {source && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-(--text-tertiary)">
          <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono" title={source}>{source}</span>
        </div>
      )}

      {/* Stack trace — collapsed by default, it is verbose noise until needed. */}
      {log.stackTrace && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setStackOpen((v) => !v)}
            aria-expanded={stackOpen}
            className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary)"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${stackOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
            Stack trace
          </button>
          {stackOpen && (
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-(--border-hairline) bg-(--surface-raised) p-2 text-xs leading-4 text-(--text-secondary)">
              {log.stackTrace}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Card list wrapper — shared spacing/semantics so live and forensic Console tabs match.
export default function ConsoleMessageList({ logs }: { logs: BrowserConsoleMessage[] }) {
  return (
    <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Browser console messages" className="flex flex-col gap-2 pb-6">
      {logs.map((log, idx) => (
        <ConsoleCard key={`${log.timestamp}-${idx}`} log={log} />
      ))}
    </div>
  );
}

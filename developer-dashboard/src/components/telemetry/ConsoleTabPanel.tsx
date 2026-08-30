import { useMemo } from 'react';
import { Terminal } from 'lucide-react';
import type { BrowserConsoleMessage } from '../../types';
import ConsoleMessageList from '../common/ConsoleMessageCard';
import EmptyState from '../common/EmptyState';

const FILTERS = ['all', 'error', 'warning', 'info', 'debug', 'log'] as const;
export type ConsoleFilter = (typeof FILTERS)[number];

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

import { useState } from 'react';
import type { BrowserConsoleLevel, BrowserConsoleMessage } from '../../types';
import { CopyButton, ExpandableCodeBlock } from '../common/ForensicCardKit';
import JumpToBottomButton from '../common/JumpToBottomButton';
import { useStickyScroll } from '../../hooks/useStickyScroll';

// Per-level pill styling so severity is visible at a glance.
const LEVEL_STYLES: Record<BrowserConsoleLevel, string> = {
  error: 'bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  info: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
  debug: 'bg-[var(--surface-inset)] text-(--text-secondary)',
  trace: 'bg-[var(--surface-inset)] text-(--text-tertiary)',
  notice: 'bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)]',
  log: 'bg-[var(--surface-inset)] text-(--text-tertiary)',
};

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface ConsoleTabPanelProps {
  browserConsole: BrowserConsoleMessage[];
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: ConsoleTabPanel
// ─────────────────────────────────────────────────────────────

export default function ConsoleTabPanel({
  browserConsole = []
}: ConsoleTabPanelProps) {
  const [expandedActionTrail, setExpandedActionTrail] = useState<Record<string, boolean>>({});
  const { containerRef, atBottom, scrollToBottom } = useStickyScroll<HTMLDivElement>(browserConsole.length);

  return (
    <div className="space-y-3 p-2">
      <div className="bg-[var(--surface-panel)] border border-(--border-hairline) rounded-lg overflow-hidden">
        <div className="bg-[var(--surface-inset)] px-4 py-3 border-b border-(--border-hairline) flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-(--text-tertiary)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-xs font-bold text-(--text-primary)">Browser Console Output</span>
          </div>
          <span className="text-[10px] text-(--text-tertiary)">Last 50 logs</span>
        </div>

        <div className="relative">
        <div ref={containerRef} className="max-h-96 overflow-y-auto custom-scrollbar bg-[var(--surface-panel)]">
          {browserConsole.length === 0 ? (
            <div className="text-(--text-tertiary) italic text-xs py-4 px-4">No browser console logs captured yet.</div>
          ) : (
            <div className="p-3 space-y-2">
              {browserConsole.map((log, idx) => (
                <div key={idx} className="group flex items-start gap-2 justify-between p-2 border border-(--border-hairline) rounded-md hover:bg-[var(--surface-hover)]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-(--text-secondary) flex-shrink-0 w-6">{idx + 1}.</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 ${LEVEL_STYLES[log.level] ?? LEVEL_STYLES.log}`}>
                        {log.level}
                      </span>
                      <span className="font-semibold text-xs whitespace-pre-wrap break-words text-(--text-secondary)">
                        {log.message}
                      </span>
                    </div>
                    {(log.url || log.line) && (
                      <div className="text-[10px] text-(--text-tertiary) pl-8 truncate">
                        {log.url}{log.line ? `:${log.line}` : ''}{log.column ? `:${log.column}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-in-out flex-shrink-0">
                    <CopyButton text={log.message} label="Log" />
                  </div>
                </div>
              ))}

              <ExpandableCodeBlock
                title="View Full Console Logs JSON"
                content={JSON.stringify(browserConsole, null, 2)}
                isExpanded={expandedActionTrail['console']}
                onToggle={() => setExpandedActionTrail(prev => ({ ...prev, 'console': !prev['console'] }))}
              />
            </div>
          )}
        </div>
        <JumpToBottomButton visible={!atBottom} onClick={scrollToBottom} />
        </div>
      </div>
    </div>
  );
}

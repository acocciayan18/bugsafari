import { useState } from 'react';
import type { BrowserConsoleMessage } from '../../types';
import { CopyButton, ExpandableCodeBlock } from '../common/ForensicCardKit';

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

  return (
    <div className="space-y-3 p-2">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden dark:bg-nova-dark dark:border-gray-700">
        <div className="bg-gray-100 px-4 py-3 border-b border-gray-200 flex items-center justify-between dark:bg-gray-800 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="text-xs font-bold text-gray-900 dark:text-gray-100">Browser Console Output</span>
          </div>
          <span className="text-[10px] text-gray-500">Last 50 logs</span>
        </div>

        <div className="max-h-96 overflow-y-auto custom-scrollbar bg-white dark:bg-nova-dark">
          {browserConsole.length === 0 ? (
            <div className="text-gray-500 italic text-xs py-4 px-4">No browser console logs captured yet.</div>
          ) : (
            <div className="p-3 space-y-2">
              {browserConsole.slice(-50).map((log, idx) => (
                <div key={idx} className="group flex items-start gap-2 justify-between p-2 border border-gray-200 rounded-md hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-gray-700 flex-shrink-0 w-6">{idx + 1}.</span>
                      <span className="font-semibold text-xs whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300">
                        {log.message}
                      </span>
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-in-out flex-shrink-0">
                    <CopyButton text={log.message} label="Log" />
                  </div>
                </div>
              ))}

              <ExpandableCodeBlock
                title="View Full Console Logs JSON"
                content={JSON.stringify(browserConsole.slice(-50), null, 2)}
                isExpanded={expandedActionTrail['console']}
                onToggle={() => setExpandedActionTrail(prev => ({ ...prev, 'console': !prev['console'] }))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

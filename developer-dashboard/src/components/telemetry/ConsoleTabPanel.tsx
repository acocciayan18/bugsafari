import { useState } from 'react';
import type { BrowserConsoleMessage } from '../../types';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface ConsoleTabPanelProps {
  browserConsole: BrowserConsoleMessage[];
}

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

const copyToClipboard = async (text: string, label = 'Content') => {
  try {
    await navigator.clipboard.writeText(text);
    console.log(`✓ ${label} copied to clipboard`);
  } catch (err) {
    console.error(`Failed to copy ${label}:`, err);
  }
};

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

/**
 * Copy button component with feedback
 */
const CopyButton = ({ text, label }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    await copyToClipboard(text, label || 'Content');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all hover:bg-slate-100 active:scale-95 text-slate-600 hover:text-slate-900"
      title={`Copy ${label || 'content'} to clipboard`}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
};

/**
 * Expandable code block component
 */
const ExpandableCodeBlock = ({
  title,
  content,
  isExpanded,
  onToggle,
  className = ''
}: {
  title: string;
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
}) => {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-slate-700 hover:bg-slate-50 transition-colors text-xs font-semibold border-b border-slate-200"
      >
        <span className="text-sm">{isExpanded ? '▼' : '▶'}</span>
        <span>{title}</span>
        <span className="text-[10px] opacity-60 ml-auto">Click to {isExpanded ? 'collapse' : 'expand'}</span>
      </button>
      {isExpanded && (
        <div className={`px-4 py-3 bg-slate-50 max-h-96 overflow-y-auto border border-slate-200 border-t-0 ${className}`}>
          <pre className="text-xs font-mono whitespace-pre-wrap wrap-break-word text-slate-700 leading-relaxed p-3 bg-white rounded border border-slate-200 overflow-x-auto">
            {content}
          </pre>
          <div className="mt-2 flex justify-end">
            <CopyButton text={content} label={title} />
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: ConsoleTabPanel
// ─────────────────────────────────────────────────────────────

export default function ConsoleTabPanel({
  browserConsole = []
}: ConsoleTabPanelProps) {
  const [expandedActionTrail, setExpandedActionTrail] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3 p-2">
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">📋</span>
            <span className="text-xs font-bold text-slate-900">Browser Console Output</span>
          </div>
          <span className="text-[10px] text-slate-500">Last 50 logs</span>
        </div>

        <div className="max-h-96 overflow-y-auto custom-scrollbar bg-white">
          {browserConsole.length === 0 ? (
            <div className="text-slate-500 italic text-xs py-4 px-4">No browser console logs captured yet.</div>
          ) : (
            <div className="p-3 space-y-2">
              {browserConsole.slice(-50).map((log, idx) => (
                <div key={idx} className="flex items-start gap-2 justify-between p-2 border border-slate-200 rounded hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-700 flex-shrink-0 w-6">{idx + 1}.</span>
                      <span className="font-semibold text-xs whitespace-pre-wrap break-words text-slate-700">
                        {log.message}
                      </span>
                    </div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
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

// TelemetryHelpModal.tsx - anchored popover explaining each telemetry tab
import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Network, HelpCircle, Terminal } from 'lucide-react';
import { useDismissableLayer } from '../../hooks/useDismissableLayer';

type HelpTabId = 'telemetry' | 'errors' | 'network' | 'console';

interface HelpTopic {
  id: HelpTabId;
  label: string;
  icon: typeof Activity;
  what: string;
  collects: string[];
  why: string;
  examples: string[];
}

const TOPICS: HelpTopic[] = [
  {
    id: 'telemetry',
    label: 'Telemetry',
    icon: Activity,
    what: 'A live feed of every step the exploration engine takes as it clicks, types, and navigates the target app.',
    collects: ['Actions executed (clicks, form fills, navigation)', 'Heuristic score updates for scored elements', 'System status messages and AI diagnostics'],
    why: 'Lets you follow the engine\'s decision-making in real time, so you can see exactly what path led to a bug.',
    examples: ['"clicked button.submit-order"', '"score update: target increased to 0.82"', 'AI-suggested fix attached to a runtime exception'],
  },
  {
    id: 'errors',
    label: 'Errors',
    icon: AlertTriangle,
    what: 'Crash reports and incidents captured when the target app throws or breaks unexpectedly.',
    collects: ['Uncaught exceptions and stack traces', 'The 20-step action buffer leading up to the crash', 'Deduplicated occurrence counts per fault'],
    why: 'The core output of BugSafari — pinpoints reproducible bugs with the exact action sequence that triggered them.',
    examples: ['TypeError: Cannot read properties of undefined', 'Unhandled promise rejection in checkout flow', 'React render crash after rapid navigation'],
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    what: 'Every HTTP request/response the target app makes while being tested.',
    collects: ['Request method, URL, and status code', 'Failed or slow requests', 'API calls triggered by fuzzed input'],
    why: 'Surfaces backend and API issues — failed calls, wrong status codes, broken integrations — that UI testing alone would miss.',
    examples: ['POST /api/cart returned 500', 'GET /api/user timed out', '404 on a broken asset link'],
  },
  {
    id: 'console',
    label: 'Console',
    icon: Terminal,
    what: 'Raw browser console output captured directly from the page under test.',
    collects: ['console.log / warn / error output', 'Browser-level warnings (deprecations, CSP, etc.)', 'Uncaught script errors printed by the browser'],
    why: 'Shows what the app itself is reporting, catching issues developers already log but that might get missed in manual testing.',
    examples: ['Warning: missing key prop', 'Uncaught ReferenceError: x is not defined', 'Deprecated API usage notice'],
  },
];

interface TelemetryHelpPopoverProps {
  activeTab?: HelpTabId;
}

export default function TelemetryHelpPopover({ activeTab = 'telemetry' }: TelemetryHelpPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeId, setActiveId] = useState<HelpTabId>(activeTab);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const containerRef = useDismissableLayer<HTMLDivElement>({ isOpen, onDismiss: close });

  useEffect(() => {
    if (isOpen) setActiveId(activeTab);
  }, [isOpen, activeTab]);

  const active = TOPICS.find((t) => t.id === activeId) ?? TOPICS[0];
  const Icon = active.icon;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        aria-label="What do these tabs show?"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="What do these tabs show?"
        className="mr-3 grid h-6 w-6 shrink-0 place-items-center rounded-full text-(--text-tertiary) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
      >
        <HelpCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Telemetry panel guide"
          className="animate-in fade-in slide-in-from-top-1 absolute right-2 top-full z-50 mt-2 mb-4 max-h-[calc(100vh-6rem)] w-[min(24rem,calc(100vw-3rem))] origin-top-right overflow-y-auto rounded-xl border border-(--border-hairline) bg-(--surface-panel) shadow-xl duration-150"
        >
          <div className="flex gap-1 border-b border-(--border-hairline) px-2 pt-2" role="tablist">
            {TOPICS.map((topic) => {
              const TopicIcon = topic.icon;
              const isActive = topic.id === activeId;
              return (
                <button
                  key={topic.id}
                  onClick={() => setActiveId(topic.id)}
                  className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-2 text-body-sm font-medium transition-colors ${
                    isActive
                      ? 'border-(--text-primary) text-(--text-primary)'
                      : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'
                  }`}
                  role="tab"
                  aria-selected={isActive}
                >
                  <TopicIcon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  {topic.label}
                </button>
              );
            })}
          </div>

          <div key={active.id} className="animate-fade-in space-y-3 px-4 py-3.5" role="tabpanel">
            <div className="flex items-start gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-(--surface-inset) text-(--text-primary)">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className="text-body-sm leading-5 text-(--text-secondary)">{active.what}</p>
            </div>

            <div>
              <div className="text-caption font-semibold uppercase tracking-wider text-(--text-tertiary)">What it collects</div>
              <ul className="mt-1 space-y-1">
                {active.collects.map((item) => (
                  <li key={item} className="flex gap-2 text-body-sm text-(--text-secondary)">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-(--text-tertiary)" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-caption font-semibold uppercase tracking-wider text-(--text-tertiary)">Why it's useful</div>
              <p className="mt-1 text-body-sm leading-5 text-(--text-secondary)">{active.why}</p>
            </div>

            <div>
              <div className="text-caption font-semibold uppercase tracking-wider text-(--text-tertiary)">Example events</div>
              <ul className="mt-1 space-y-1">
                {active.examples.map((item) => (
                  <li key={item} className="rounded-md bg-(--surface-inset) px-2 py-1 font-mono text-caption text-(--text-secondary)">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-(--border-hairline) px-4 py-1.5">
            <p className="text-caption text-(--text-disabled)">Press ESC to close</p>
          </div>
        </div>
      )}
    </div>
  );
}

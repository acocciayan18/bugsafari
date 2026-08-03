// TelemetryHelpModal.tsx - anchored popover explaining each telemetry tab
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, AlertTriangle, Network, HelpCircle, Terminal, X } from 'lucide-react';
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
    label: 'Findings',
    icon: AlertTriangle,
    what: 'Crash reports and incidents captured when the target app throws or breaks unexpectedly.',
    collects: ['Uncaught exceptions and stack traces', 'The 20-step action buffer leading up to the crash', 'Deduplicated occurrence counts per fault'],
    why: 'The core output of BugSafari. It pinpoints reproducible bugs with the exact action sequence that triggered them.',
    examples: ['TypeError: Cannot read properties of undefined', 'Unhandled promise rejection in checkout flow', 'React render crash after rapid navigation'],
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    what: 'Every HTTP request/response the target app makes while being tested.',
    collects: ['Request method, URL, and status code', 'Failed or slow requests', 'API calls triggered by fuzzed input'],
    why: 'Surfaces backend and API issues (failed calls, wrong status codes, broken integrations) that UI testing alone would miss.',
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
        className="touch-target cursor-pointer mr-2 grid h-6 w-6 shrink-0 place-items-center rounded-full text-(--text-tertiary) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary) sm:mr-3"
      >
        <HelpCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>

      <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-label="Telemetry panel guide"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          // Under `sm` this is pinned to the VIEWPORT, not to the trigger — an anchored
          // popover on a narrow pane could not stay on screen and still be readable.
          className="custom-scrollbar fixed inset-x-3 bottom-3 z-50 flex max-h-[75dvh] origin-bottom flex-col overflow-hidden rounded-xl border border-(--border-hairline) bg-(--surface-panel) shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-2 sm:top-full sm:mt-2 sm:max-h-[calc(100dvh-8rem)] sm:w-96 sm:max-w-[calc(100vw-2rem)] sm:origin-top-right"
        >
          <div className="flex shrink-0 items-start gap-1 border-b border-(--border-hairline) px-2 pt-2">
            <div className="scroll-rail flex min-w-0 flex-1 gap-1" role="tablist">
              {TOPICS.map((topic) => {
                const TopicIcon = topic.icon;
                const isActive = topic.id === activeId;
                return (
                  <button
                    key={topic.id}
                    onClick={() => setActiveId(topic.id)}
                    className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-2.5 py-2 text-body-sm font-medium transition-colors ${
                      isActive
                        ? 'border-(--text-primary) text-(--text-primary)'
                        : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'
                    }`}
                    role="tab"
                    aria-selected={isActive}
                  >
                    <TopicIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    {topic.label}
                  </button>
                );
              })}
            </div>
            {/* ESC is not reachable on touch, so the sheet needs its own dismiss. */}
            <button
              type="button"
              onClick={close}
              aria-label="Close guide"
              className="mt-0.5 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-(--text-tertiary) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
            >
              <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="space-y-3 px-3 py-3.5 sm:px-4"
              role="tabpanel"
            >
              <div className="flex items-start gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-(--surface-inset) text-(--text-primary)">
                  <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <p className="min-w-0 text-body-sm leading-5 text-(--text-secondary)">{active.what}</p>
              </div>

              <div>
                <div className="text-caption font-semibold uppercase r text-(--text-tertiary)">What it collects</div>
                <ul className="mt-1 space-y-1">
                  {active.collects.map((item) => (
                    <li key={item} className="flex min-w-0 gap-2 text-body-sm text-(--text-secondary)">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-(--text-tertiary)" />
                      <span className="min-w-0 break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-caption font-semibold uppercase r text-(--text-tertiary)">Why it's useful</div>
                <p className="mt-1 text-body-sm leading-5 text-(--text-secondary)">{active.why}</p>
              </div>

              <div>
                <div className="text-caption font-semibold uppercase r text-(--text-tertiary)">Example events</div>
                <ul className="mt-1 space-y-1">
                  {active.examples.map((item) => (
                    <li key={item} className="break-words rounded-md bg-(--surface-inset) px-2 py-1 font-mono text-caption text-(--text-secondary)">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>

          <div className="hidden shrink-0 border-t border-(--border-hairline) px-3 py-1.5 sm:block sm:px-4">
            <p className="text-caption text-(--text-disabled)">Press ESC to close</p>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

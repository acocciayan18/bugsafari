// ═══════════════════════════════════════════════════════════════
// ForensicInspectionDrawer - Side-sliding session inspection overlay
// ═══════════════════════════════════════════════════════════════
// Replaces the History tab's inline accordion. When a session row is clicked,
// this drawer slides in from the right, fetches the full forensic report for
// that session, and presents it in a high-contrast, tabbed workspace:
//   • Header Badge Matrix  — runtime / action count / target URL / status
//   • Timeline Steps       — the persisted chronological actionSteps trace
//   • Technical Exceptions — error stack traces + caught vulnerabilities
//   • Intelligent Recos    — AI recommendations + per-bug remediation advice

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ForensicReportResponse, ForensicActionStep } from '../../types';
import { fetchForensicReport } from '../../services/historyService';
import { ReproducibleSteps } from './ReproducibleSteps';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ForensicInspectionDrawerProps {
  sessionId: string | null;
  onClose: () => void;
}

type DrawerTab = 'timeline' | 'exceptions' | 'recommendations';

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Format a duration in milliseconds to a compact human-readable string.
function formatDuration(ms: number): string {
  if (!ms || ms < 0) return 'N/A';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

type CaughtBug = ForensicReportResponse['forensicTrace']['caughtBugs'][number];

// ─────────────────────────────────────────────────────────────
// CATEGORY COLOR MATRIX
// Functional-intent categories drive the timeline badge colors and the filter
// pills. `bypass`/`input`/`click`/`navigation` map from the stored actionType;
// `crash` is derived by correlating a step to a captured vulnerability.
// ─────────────────────────────────────────────────────────────

type StepCategory = 'bypass' | 'input' | 'click' | 'navigation' | 'crash';

const CATEGORY_STYLE: Record<StepCategory, { label: string; verb: string; icon: string; badge: string; dot: string }> = {
  bypass:     { label: 'Bypass Safeguards', verb: 'Submitted / bypassed', icon: '🛡️', badge: 'bg-amber-100 text-amber-800 border-amber-300',  dot: 'bg-amber-500' },
  input:      { label: 'Data Infiltration', verb: 'Entered data into',    icon: '⌨️', badge: 'bg-cyan-100 text-cyan-800 border-cyan-300',    dot: 'bg-cyan-500' },
  click:      { label: 'Click Interaction', verb: 'Clicked',              icon: '🔍', badge: 'bg-slate-100 text-slate-700 border-slate-300', dot: 'bg-slate-500' },
  navigation: { label: 'Navigation',        verb: 'Navigated via',        icon: '🌍', badge: 'bg-indigo-100 text-indigo-700 border-indigo-300', dot: 'bg-indigo-500' },
  crash:      { label: 'Fatal Exception',   verb: 'Crashed at',           icon: '💥', badge: 'bg-red-100 text-red-700 border-red-400',       dot: 'bg-red-600' },
};

// Correlate a step with the captured forensic record to assign its category.
// A step is a `crash` when its selector/payload matches a caught bug, or it is
// the final step of a CRASHED session (the precise moment the barrier broke).
function deriveCategory(
  step: ForensicActionStep,
  caughtBugs: CaughtBug[],
  isLastStep: boolean,
  sessionStatus: string,
): StepCategory {
  const selector = (step.selector ?? '').trim();
  const correlatesToBug = caughtBugs.some((bug) => {
    const bugSelector = (bug.selector ?? '').trim();
    if (selector && bugSelector && bugSelector === selector) return true;
    if (step.payloadText && bug.payloadUsed && bug.payloadUsed === step.payloadText) return true;
    return false;
  });
  if (correlatesToBug) return 'crash';
  if (isLastStep && sessionStatus === 'CRASHED') return 'crash';

  switch (step.actionType) {
    case 'bypass':     return 'bypass';
    case 'input':      return 'input';
    case 'navigation': return 'navigation';
    case 'click':      return 'click';
    default:           return 'click';
  }
}

// Build a clean markdown reproduction playbook ready to paste into a ticket.
function buildReproductionMarkdown(report: ForensicReportResponse): string {
  const bugs = report.forensicTrace?.caughtBugs ?? [];
  const steps = report.actionSteps ?? [];
  const actionCount = report.metrics?.totalActions || steps.length || 0;

  const lines: string[] = [
    '## 🦁 BugSafari Reproduction Playbook',
    '',
    `**Target:** ${report.url || 'N/A'}`,
    `**Status:** ${report.status}  ·  **Runtime:** ${formatDuration(report.duration)}  ·  **Actions:** ${actionCount}`,
    '',
  ];

  if (steps.length > 0) {
    lines.push('### Steps to Reproduce');
    steps.forEach((step, idx) => {
      const category = deriveCategory(step, bugs, idx === steps.length - 1, report.status);
      const target = step.selector || '(unknown target)';
      let line = `${idx + 1}. **${CATEGORY_STYLE[category].verb}** \`${target}\``;
      if (step.payloadText) line += ` — payload: \`${step.payloadText}\``;
      lines.push(line);
    });
    lines.push('');
  } else if (report.forensicTrace?.finalBreadcrumbSteps?.length) {
    lines.push('### Steps to Reproduce');
    report.forensicTrace.finalBreadcrumbSteps.forEach((s, idx) => lines.push(`${idx + 1}. ${s}`));
    lines.push('');
  }

  if (bugs.length > 0) {
    lines.push('### Vulnerabilities Triggered');
    bugs.forEach((bug) => {
      const sel = bug.selector ? ` (\`${bug.selector}\`)` : '';
      lines.push(`- **${bug.type || 'BUG'}** — ${bug.message || 'No message'}${sel}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// Copy text to the clipboard, returning whether it succeeded.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('[ForensicInspectionDrawer] Clipboard copy failed:', err);
    return false;
  }
}

function statusTint(status: string): string {
  if (status === 'COMPLETED') return 'border-green-400 bg-green-50 text-green-700';
  if (status === 'CRASHED') return 'border-red-400 bg-red-50 text-red-700';
  return 'border-amber-400 bg-amber-50 text-amber-700';
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function BadgeCard({ label, value, title, className }: { label: string; value: string; title?: string; className?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${className ?? 'border-slate-200 bg-slate-50'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold text-slate-900" title={title ?? value}>
        {value}
      </div>
    </div>
  );
}

// Self-contained copy button with 2s "Copied!" feedback (mirrors the idiom in
// telemetry/ErrorTabPanel.tsx). Pass no label for an icon-only variant.
function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const caption = copied ? 'Copied!' : label;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label ?? 'Copy to clipboard'}
      className={`inline-flex items-center gap-1.5 rounded text-xs font-medium transition-all active:scale-95 ${className ?? 'px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      {caption && <span>{caption}</span>}
    </button>
  );
}

const TIMELINE_FILTERS: Array<{ id: 'all' | 'bypass' | 'input' | 'crash'; label: string; activeClass: string }> = [
  { id: 'all',    label: 'All Steps',       activeClass: 'bg-slate-900 text-white' },
  { id: 'bypass', label: 'Bypasses Only',   activeClass: 'bg-amber-500 text-white' },
  { id: 'input',  label: 'Injections Only', activeClass: 'bg-cyan-500 text-white' },
  { id: 'crash',  label: 'Crashes Only',    activeClass: 'bg-red-600 text-white' },
];

function TimelineTab({ actionSteps, report }: { actionSteps: ForensicActionStep[]; report: ForensicReportResponse }) {
  const [filter, setFilter] = useState<'all' | 'bypass' | 'input' | 'crash'>('all');

  // Categorize every step once, then derive per-category counts for the pills.
  const categorized = useMemo(() => {
    const bugs = report.forensicTrace?.caughtBugs ?? [];
    return actionSteps.map((step, idx) => ({
      step,
      category: deriveCategory(step, bugs, idx === actionSteps.length - 1, report.status),
    }));
  }, [actionSteps, report.forensicTrace?.caughtBugs, report.status]);

  const counts = useMemo(() => {
    const c: Record<'all' | 'bypass' | 'input' | 'crash', number> = { all: categorized.length, bypass: 0, input: 0, crash: 0 };
    categorized.forEach(({ category }) => {
      if (category === 'bypass') c.bypass++;
      else if (category === 'input') c.input++;
      else if (category === 'crash') c.crash++;
    });
    return c;
  }, [categorized]);

  // Prefer the structured actionSteps. Fall back to the human-readable
  // breadcrumb strings for older sessions that predate it.
  if (!actionSteps || actionSteps.length === 0) {
    if (report.forensicTrace?.finalBreadcrumbSteps?.length) {
      return (
        <ReproducibleSteps
          steps={report.forensicTrace.finalBreadcrumbSteps}
          findings={report.forensicTrace.caughtBugs}
        />
      );
    }
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <span className="text-3xl">🧭</span>
        <span className="text-sm font-medium text-slate-600">No action trail recorded</span>
        <span className="text-xs text-slate-400">This session ended before any steps were captured.</span>
      </div>
    );
  }

  const visible = filter === 'all' ? categorized : categorized.filter((c) => c.category === filter);

  return (
    <div>
      {/* QoL toolbar — category filter pills + copy reproduction snippet */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
          {TIMELINE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f.id ? f.activeClass : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label} · {counts[f.id]}
            </button>
          ))}
        </div>
        <CopyButton
          text={buildReproductionMarkdown(report)}
          label="Copy Reproduction Snippet"
          className="border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
        />
      </div>

      {visible.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">No steps in this category.</div>
      ) : (
        <ol className="relative ml-3 border-l-2 border-slate-200">
          {visible.map(({ step, category }) => {
            const style = CATEGORY_STYLE[category];
            return (
              <li key={step.stepNumber} className="relative mb-5 pl-6">
                <span className={`absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-4 ring-white ${style.dot}`}>
                  {step.stepNumber}
                </span>
                <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{style.icon}</span>
                    <span className="text-sm font-semibold text-slate-800">{style.verb}</span>
                    <span className="font-mono text-xs text-slate-700">{step.selector || '(unknown target)'}</span>
                    <span className={`ml-auto rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>
                  {step.payloadText && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payload</span>
                      <code className="max-w-full truncate rounded bg-red-50 px-2 py-0.5 font-mono text-xs text-red-600" title={step.payloadText}>
                        {step.payloadText}
                      </code>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ExceptionsTab({ report }: { report: ForensicReportResponse }) {
  const errors = report.errorLogs?.errors ?? [];
  const bugs = report.forensicTrace?.caughtBugs ?? [];

  if (errors.length === 0 && bugs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <span className="text-3xl">✅</span>
        <span className="text-sm font-medium text-slate-600">No technical exceptions</span>
        <span className="text-xs text-slate-400">This run completed without captured faults or stack traces.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errors.map((err, idx) => (
        <div key={err.id ?? `err-${idx}`} className="rounded-md border-2 border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-red-100 pb-2">
            <span className="rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">
              {err.type ?? 'EXCEPTION'}
            </span>
            {err.severity && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">{err.severity}</span>
            )}
            {typeof err.statusCode === 'number' && (
              <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">HTTP {err.statusCode}</span>
            )}
          </div>
          <p className="mb-2 text-sm font-semibold text-slate-800">{err.message ?? 'No message provided'}</p>
          {(err.url || err.endpoint) && (
            <p className="mb-2 break-all font-mono text-xs text-slate-500">{err.method ? `${err.method} ` : ''}{err.endpoint ?? err.url}</p>
          )}
          {err.stackTrace && (
            <pre className="max-h-48 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-green-400">
              {err.stackTrace}
            </pre>
          )}
        </div>
      ))}

      {bugs.map((bug) => (
        <div key={bug.bugId} className="rounded-md border-2 border-red-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-red-100 pb-2">
            <span className="rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">{bug.type || 'BUG'}</span>
            <span className="font-mono text-[10px] text-red-400">ID: {bug.bugId}</span>
          </div>
          <p className="mb-2 text-sm font-semibold text-slate-800">{bug.message || 'No message provided'}</p>
          {bug.selector && (
            <p className="mb-1 break-all font-mono text-xs text-slate-600">
              <span className="font-semibold text-slate-400">Target: </span>{bug.selector}
            </p>
          )}
          {bug.payloadUsed && (
            <p className="break-all font-mono text-xs text-red-600">
              <span className="font-semibold text-slate-400">Payload: </span>{bug.payloadUsed}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function RecommendationsTab({ report }: { report: ForensicReportResponse }) {
  const recommendations = report.aiAnalysis?.recommendations ?? [];
  const adviceBugs = (report.forensicTrace?.caughtBugs ?? []).filter((b) => b.advice);

  if (recommendations.length === 0 && adviceBugs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <span className="text-3xl">💡</span>
        <span className="text-sm font-medium text-slate-600">No recommendations available</span>
        <span className="text-xs text-slate-400">No remediation guidance was generated for this session.</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {report.aiAnalysis?.rootCause && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-500">Root Cause</div>
          <p className="text-sm text-slate-800">{report.aiAnalysis.rootCause}</p>
        </div>
      )}

      {recommendations.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">Proactive Recommendations</h4>
          <div className="space-y-3">
            {recommendations.map((rec, idx) => (
              <div key={`rec-${idx}`} className="relative rounded-md border border-slate-700 bg-slate-900 p-3 shadow-sm">
                <CopyButton
                  text={rec}
                  className="absolute right-2 top-2 bg-slate-800/80 px-1.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white"
                />
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Recommendation</span>
                </div>
                <pre className="whitespace-pre-wrap break-words pr-10 font-mono text-xs leading-relaxed text-green-400">{rec}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {adviceBugs.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">Fixes Mapped to Detected Errors</h4>
          <div className="space-y-3">
            {adviceBugs.map((bug) => (
              <div key={bug.bugId} className="relative rounded-md border border-emerald-700 bg-slate-900 p-3 shadow-sm">
                <CopyButton
                  text={bug.advice}
                  className="absolute right-2 top-2 bg-slate-800/80 px-1.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white"
                />
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">{bug.type || 'FIX'}</span>
                  {bug.selector && <span className="font-mono text-[11px] text-slate-400">{bug.selector}</span>}
                </div>
                <pre className="whitespace-pre-wrap break-words pr-10 font-mono text-xs leading-relaxed text-emerald-300">{bug.advice}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

const TAB_LABELS: Record<DrawerTab, string> = {
  timeline: 'Timeline Steps',
  exceptions: 'Technical Exceptions',
  recommendations: 'Intelligent Recommendations',
};

export default function ForensicInspectionDrawer({ sessionId, onClose }: ForensicInspectionDrawerProps) {
  const [report, setReport] = useState<ForensicReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DrawerTab>('timeline');
  // Drives the enter/exit slide transition independently of mount state.
  const [isVisible, setIsVisible] = useState(false);
  const reloadRef = useRef<() => void>(() => {});

  const isOpen = sessionId !== null;

  // Fetch the report whenever a new session is selected. A stale-response guard
  // (cancelled flag) prevents an earlier request from overwriting a newer one.
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    // All state mutation lives inside `load` (kept out of the effect body so it
    // runs as part of the fetch flow rather than as a synchronous render trigger).
    const load = (resetTab: boolean) => {
      if (resetTab) setActiveTab('timeline');
      setReport(null);
      setError(null);
      setIsLoading(true);
      fetchForensicReport(sessionId)
        .then((result) => {
          if (!cancelled) setReport(result);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report');
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    };

    // Retry button re-runs the fetch without resetting the active tab.
    reloadRef.current = () => load(false);
    load(true);

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Trigger the slide-in transition one frame after mount, and lock body scroll.
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => setIsVisible(true));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      setIsVisible(false);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Forensic session inspection">
      {/* Backdrop — blurs and dims the underlying data grid to emphasise focus */}
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      {/* Sliding panel */}
      <section
        className={`absolute right-0 top-0 z-50 flex h-full w-full transform flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out md:w-[55%] ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-wide text-slate-900">FORENSIC INSPECTION</span>
              <span className="text-slate-300">/</span>
              <span className="font-mono text-xs text-slate-500">{sessionId.slice(-12)}</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close inspection drawer"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Header Badge Matrix */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BadgeCard label="Runtime" value={report ? formatDuration(report.duration) : '—'} />
            <BadgeCard
              label="Total Actions"
              value={report ? String(report.metrics?.totalActions || report.actionSteps?.length || 0) : '—'}
            />
            <BadgeCard
              label="Target URL"
              value={report?.url ?? '—'}
              title={report?.url}
              className="border-slate-200 bg-slate-50 md:col-span-1"
            />
            <BadgeCard
              label="Status"
              value={report?.status ?? '—'}
              className={report ? statusTint(report.status) : 'border-slate-200 bg-slate-50'}
            />
          </div>
        </header>

        {/* Tab bar */}
        <nav className="flex shrink-0 border-b border-slate-200 bg-slate-50">
          {(Object.keys(TAB_LABELS) as DrawerTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-4 py-2.5 text-xs font-medium tracking-wide transition-colors ${
                activeTab === tab
                  ? 'border-black text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
              <span className="text-sm text-slate-500">Loading forensic report…</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <svg className="h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-medium text-red-600">Failed to load report</span>
              <span className="text-xs text-slate-500">{error}</span>
              <button
                onClick={() => reloadRef.current()}
                className="mt-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Try Again
              </button>
            </div>
          ) : report ? (
            <>
              {activeTab === 'timeline' && <TimelineTab actionSteps={report.actionSteps ?? []} report={report} />}
              {activeTab === 'exceptions' && <ExceptionsTab report={report} />}
              {activeTab === 'recommendations' && <RecommendationsTab report={report} />}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

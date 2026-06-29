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
// Composed from the SAME per-finding failures rendered as cards, so the copied
// snippet mirrors the on-screen content exactly (each fault, its own frozen
// reproduction steps, and its own Suggested Fix).
function buildReproductionMarkdown(report: ForensicReportResponse): string {
  const failures = buildFailures(report);
  const actionCount = report.metrics?.totalActions || report.actionSteps?.length || 0;

  const lines: string[] = [
    '## 🦁 BugSafari Reproduction Playbook',
    '',
    `**Target:** ${report.url || 'N/A'}`,
    `**Status:** ${report.status}  ·  **Runtime:** ${formatDuration(report.duration)}  ·  **Actions:** ${actionCount}`,
    '',
  ];

  if (failures.length === 0) {
    lines.push('_Session completed without captured faults._', '');
    return lines.join('\n');
  }

  failures.forEach((failure, idx) => {
    const sel = failure.selector ? ` (\`${failure.selector}\`)` : '';
    lines.push(`### Failure #${idx + 1} — ${failure.type || 'FAILURE'}`);
    lines.push(`${failure.message || 'No message'}${sel}`, '');

    const steps = failure.reproductionSteps ?? [];
    if (steps.length > 0) {
      lines.push('**Steps to Reproduce**');
      steps.forEach((step, sIdx) => {
        // Normalize any pre-existing "Step N." prefix so numbering stays sequential.
        lines.push(`${sIdx + 1}. ${step.replace(/^step\s*\d+[:.]\s*/i, '')}`);
      });
      lines.push('');
    }

    if (failure.advice) {
      lines.push('**Suggested Fix**', '```', failure.advice, '```', '');
    }
  });

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

type StepFilter = 'all' | 'bypass' | 'input' | 'crash';

// The unified, category-colored "Step X." reproduction trail. Shared by every
// failure card and the clean-run card, honoring the active category filter.
function PlaybookStepList({ actionSteps, report, filter }: { actionSteps: ForensicActionStep[]; report: ForensicReportResponse; filter: StepFilter }) {
  const bugs = report.forensicTrace?.caughtBugs ?? [];
  const categorized = actionSteps.map((step, idx) => ({
    step,
    category: deriveCategory(step, bugs, idx === actionSteps.length - 1, report.status),
  }));
  const visible = filter === 'all' ? categorized : categorized.filter((c) => c.category === filter);

  if (visible.length === 0) {
    return <div className="py-6 text-center text-xs text-slate-400">No steps in this category.</div>;
  }

  return (
    <ol className="relative ml-3 border-l-2 border-slate-200">
      {visible.map(({ step, category }) => {
        const style = CATEGORY_STYLE[category];
        return (
          <li key={step.stepNumber} className="relative mb-4 pl-6">
            <span className={`absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-4 ring-white ${style.dot}`}>
              {step.stepNumber}
            </span>
            <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold text-slate-400">Step {step.stepNumber}.</span>
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
  );
}

// Render the shared reproduction trail, preferring structured actionSteps and
// falling back to the human-readable breadcrumb strings for older sessions.
function PlaybookStepsSection({ report, filter }: { report: ForensicReportResponse; filter: StepFilter }) {
  if (report.actionSteps && report.actionSteps.length > 0) {
    return <PlaybookStepList actionSteps={report.actionSteps} report={report} filter={filter} />;
  }
  if (report.forensicTrace?.finalBreadcrumbSteps?.length) {
    return <ReproducibleSteps steps={report.forensicTrace.finalBreadcrumbSteps} findings={[]} />;
  }
  return <div className="py-4 text-center text-xs text-slate-400">No reproduction steps recorded.</div>;
}

// A normalized failure — sourced from either a caught bug or a forensic error
// row. Every distinct entry is preserved (no collapsing).
interface Failure {
  key: string;
  type: string;
  message: string;
  selector?: string;
  payload?: string;
  stackTrace?: string;
  statusCode?: number;
  endpoint?: string;
  method?: string;
  timestamp?: string;
  advice?: string;
  reproductionSteps?: string[];
}

function buildFailures(report: ForensicReportResponse): Failure[] {
  // The engine's caughtBugs array is the lossless source of truth — each entry
  // carries its own frozen `reproductionSteps` and `advice`. A given fault is
  // also written to the separate forensic_errors collection (errorLogs.errors),
  // so merging both would render every fault TWICE. Prefer caughtBugs; fall back
  // to errorLogs only for legacy sessions saved before caughtBugs was lossless.
  const fromBugs: Failure[] = (report.forensicTrace?.caughtBugs ?? []).map((b, i) => ({
    key: b.bugId || `bug-${i}`,
    type: b.type || 'BUG',
    message: b.message,
    selector: b.selector,
    payload: b.payloadUsed,
    stackTrace: b.stackTrace,
    reproductionSteps: b.reproductionSteps,
    timestamp: b.timestamp,
    advice: b.advice,
  }));
  if (fromBugs.length > 0) {
    return fromBugs;
  }
  return (report.errorLogs?.errors ?? []).map((e, i) => ({
    key: e.id || `err-${i}`,
    type: e.type || 'EXCEPTION',
    message: e.message || 'No message provided',
    selector: e.selector,
    stackTrace: e.stackTrace,
    statusCode: e.statusCode,
    endpoint: e.endpoint,
    method: e.method,
    timestamp: e.createdAt,
  }));
}

// A per-finding, sequentially numbered replication checklist (the exact steps
// captured for THIS error). Any pre-existing "Step N:" prefix is normalized away
// so numbering stays strictly sequential.
function FindingChecklist({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, idx) => (
        <li key={idx} className="flex gap-3 rounded-md border border-slate-200 bg-white p-2.5 shadow-sm">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">
            {idx + 1}
          </span>
          <span className="text-sm text-slate-700">{step.replace(/^step\s*\d+[:.]\s*/i, '')}</span>
        </li>
      ))}
    </ol>
  );
}

// One distinct failure rendered as a vertical card: Header → Playbook Steps →
// Suggested Fix (consolidated; no tabs).
function FailureCard({ failure, index }: { failure: Failure; index: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      {/* 1 — Bug Card Header: type, crash trace, captured metadata */}
      <div className="border-b border-slate-200 bg-red-50 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">{failure.type || 'FAILURE'}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Failure #{index + 1}</span>
          {typeof failure.statusCode === 'number' && (
            <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">HTTP {failure.statusCode}</span>
          )}
          {failure.timestamp && (
            <span className="ml-auto font-mono text-[10px] text-slate-400">{failure.timestamp}</span>
          )}
        </div>
        <p className="text-sm font-semibold text-slate-800">{failure.message || 'No message provided'}</p>
        {(failure.endpoint || failure.method) && (
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{failure.method ? `${failure.method} ` : ''}{failure.endpoint}</p>
        )}
        {(failure.selector || failure.payload) && (
          <div className="mt-2 grid gap-1">
            {failure.selector && (
              <p className="break-all font-mono text-xs text-slate-600"><span className="font-semibold text-slate-400">Target: </span>{failure.selector}</p>
            )}
            {failure.payload && (
              <p className="break-all font-mono text-xs text-red-600"><span className="font-semibold text-slate-400">Payload: </span>{failure.payload}</p>
            )}
          </div>
        )}
        {failure.stackTrace && (
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-900 p-2 font-mono text-xs text-green-400">{failure.stackTrace}</pre>
        )}
      </div>

      {/* 2 — Playbook Steps: human-actionable replication bound STRICTLY to THIS
          finding's own frozen checklist. No fallback to the global session trail —
          the steps shown are exactly the ones captured for this fault. */}
      <div className="border-b border-slate-200 p-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Playbook Steps</div>
        {failure.reproductionSteps && failure.reproductionSteps.length > 0 ? (
          <FindingChecklist steps={failure.reproductionSteps} />
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs italic text-slate-400">
            No deterministic steps were recorded for this fault.
          </div>
        )}
      </div>

      {/* 3 — Suggested Fix: clean, copyable remediation code block */}
      <div className="p-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested Fix</div>
        {failure.advice ? (
          <div className="relative rounded-md border border-emerald-700 bg-slate-900 p-3 shadow-sm">
            <CopyButton
              text={failure.advice}
              className="absolute right-2 top-2 bg-slate-800/80 px-1.5 py-1 text-slate-300 hover:bg-slate-700 hover:text-white"
            />
            <pre className="whitespace-pre-wrap break-words pr-10 font-mono text-xs leading-relaxed text-emerald-300">{failure.advice}</pre>
          </div>
        ) : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs italic text-slate-400">
            No remediation advisory generated for this failure.
          </div>
        )}
      </div>
    </div>
  );
}

// The consolidated, tab-free workspace: a copy-snippet toolbar followed by one
// vertical card per distinct failure, each bound strictly to its own finding.
// A clean run shows a single steps-only card with the session trail.
function ConsolidatedWorkspace({ report }: { report: ForensicReportResponse }) {
  const failures = useMemo(() => buildFailures(report), [report]);

  return (
    <div className="space-y-5">
      {/* Top toolbar — copy snippet (no tabs, no global-timeline filters) */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <CopyButton
          text={buildReproductionMarkdown(report)}
          label="Copy Reproduction Snippet"
          className="border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
        />
      </div>

      {failures.length > 0 ? (
        <div className="space-y-5">
          {failures.map((failure, idx) => (
            <FailureCard key={failure.key} failure={failure} index={idx} />
          ))}
        </div>
      ) : (
        // Clean run — a single steps-only card (no advisory). The session trail
        // here is informational (no error card to map against), not a per-finding
        // binding, so it legitimately renders the shared timeline.
        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-green-50 p-4">
            <span className="rounded bg-green-600 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">No Failures</span>
            <span className="text-sm font-semibold text-slate-700">Session completed without captured faults.</span>
          </div>
          <div className="p-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Session Trail</div>
            <PlaybookStepsSection report={report} filter="all" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

export default function ForensicInspectionDrawer({ sessionId, onClose }: ForensicInspectionDrawerProps) {
  const [report, setReport] = useState<ForensicReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const load = () => {
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

    reloadRef.current = load;
    load();

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

        {/* Consolidated workspace (no tabs) */}
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
            <ConsolidatedWorkspace report={report} />
          ) : null}
        </div>
      </section>
    </div>
  );
}

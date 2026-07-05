// ═══════════════════════════════════════════════════════════════
// ForensicReport.tsx - Full-Screen Forensic Report Page
// ═══════════════════════════════════════════════════════════════
// Renders a saved session's forensic report as a single cohesive
// document: an always-visible executive summary, an AI insights
// panel (when available), and one self-contained card per finding
// that groups its message, attribution, reproduction steps, and
// suggested fix together — instead of four disconnected flat lists
// (findings / error logs / action steps / AI analysis) a user
// previously had to reconcile by hand.
//
// `forensicTrace.caughtBugs` is the authoritative, fully-classified
// finding set (attribution, reproduction steps, advice all resolved
// server-side) — `errorLogs.errors` is the same underlying event
// stream pre-classification, so it is not rendered as a second,
// duplicate list here.

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { fetchForensicReport } from '../../services/historyService';
import type { ForensicActionStep, ForensicCaughtBug, ForensicReportResponse, VerifyFixRequest } from '../../types';
import ReproductionChecklist from '../telemetry/ReproductionChecklist';
import { CoverageDisplay } from '../history/CoverageProgressBar';
import { AttributionBadges, CopyButton, ExpandableCodeBlock, SuggestedFixBlock } from '../common/ForensicCardKit';
import { useRegressionVerifier, type VerifyStatus } from '../../application/useCases/useRegressionVerifier';

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'N/A';

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatDate(value?: string): string {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString();
}

function statusTheme(status: string): { text: string; dot: string; bg: string; border: string } {
  if (status === 'CRASHED') return { text: 'text-red-700', dot: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200' };
  if (status === 'HALTED') return { text: 'text-amber-700', dot: 'bg-amber-500', bg: 'bg-amber-50', border: 'border-amber-200' };
  return { text: 'text-green-700', dot: 'bg-green-500', bg: 'bg-green-50', border: 'border-green-200' };
}

function riskTheme(score: number): string {
  if (score >= 70) return 'text-red-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-green-600';
}

// ─────────────────────────────────────────────────────────────
// Executive summary — always-visible stat grid (no accordion; this
// is the at-a-glance context every reader needs immediately).
// ─────────────────────────────────────────────────────────────

function StatBlock({ label, value, valueClassName = 'text-gray-900' }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${valueClassName}`}>{value}</div>
    </div>
  );
}

function ExecutiveSummary({ report, sessionId }: { report: ForensicReportResponse; sessionId: string }) {
  const theme = statusTheme(report.status);
  const findingsTotal = report.findings?.totalBugsFound ?? report.metrics?.totalBugsFound ?? 0;

  return (
    <section className={`rounded-xl border ${theme.border} ${theme.bg} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
            <span className={`text-sm font-bold uppercase tracking-wide ${theme.text}`}>{report.status || 'UNKNOWN'}</span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-gray-700" title={report.url}>{report.url || 'N/A'}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
            <span>Run {sessionId}</span>
            <span>•</span>
            <span>Started {formatDate(report.date)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-200/70 pt-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatBlock label="Duration" value={formatDuration(report.duration)} />
        <StatBlock label="Actions" value={report.metrics?.totalActions ?? 0} />
        <StatBlock label="Findings" value={findingsTotal} valueClassName={findingsTotal > 0 ? 'text-red-600' : 'text-green-600'} />
        <StatBlock label="Risk Score" value={report.riskScore ?? 0} valueClassName={riskTheme(report.riskScore ?? 0)} />
        <StatBlock label="Coverage" value={<CoverageDisplay percentage={report.coverage ?? 0} />} />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// AI Insights — session-level analysis, shown as its own distinct,
// always-visible panel (not per-finding data, so it isn't grouped
// into the finding cards below).
// ─────────────────────────────────────────────────────────────

function AiInsightsPanel({ aiAnalysis }: { aiAnalysis: ForensicReportResponse['aiAnalysis'] }) {
  if (!aiAnalysis || (!aiAnalysis.rootCause && !aiAnalysis.recommendations?.length)) return null;

  return (
    <section className="rounded-lg border border-blue-100 bg-blue-50 p-5 dark:bg-blue-950/20 dark:border-blue-900">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span>AI Insights</span>
        {aiAnalysis.riskLevel && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700">
            {aiAnalysis.riskLevel} risk
          </span>
        )}
      </div>
      {aiAnalysis.rootCause && (
        <p className="mt-3 text-sm leading-relaxed text-gray-900 dark:text-gray-100">{aiAnalysis.rootCause}</p>
      )}
      {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {aiAnalysis.recommendations.map((recommendation, idx) => (
            <li key={idx} className="flex gap-2 text-xs text-gray-700 dark:text-gray-300">
              <span className="text-blue-500">→</span>
              <span>{recommendation}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Finding card — the core of the redesign. Everything about ONE bug
// (identity, attribution, message/selector/payload, reproduction
// steps, suggested fix, stack trace) lives in a single card instead
// of being spread across separate Findings / Error Logs / Action
// Steps sections.
// ─────────────────────────────────────────────────────────────

function buildBugSummaryText(bug: ForensicCaughtBug, index: number): string {
  const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
  return [
    `Finding #${index + 1}: ${bugClass}`,
    bug.message ? `Message: ${bug.message}` : '',
    bug.selector ? `Selector: ${bug.selector}` : '',
    bug.payloadUsed ? `Payload: ${bug.payloadUsed}` : '',
    `Detected: ${formatDate(bug.timestamp)}`,
    bug.advice ? `\nSuggested Fix:\n${bug.advice}` : '',
    bug.reproductionSteps?.length ? `\nReproduction Steps:\n${bug.reproductionSteps.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────
// Verify Fix — per-finding regression replay control. Idle shows a
// trigger; running shows a spinner; a completed result renders a
// color-coded verdict badge (VERIFIED / BUG PERSISTS / INCONCLUSIVE)
// with the engine's summary as the tooltip. Clicking a settled badge
// re-runs the replay (e.g. after another code change).
// ─────────────────────────────────────────────────────────────

const VERDICT_THEME: Record<string, { label: string; className: string }> = {
  VERIFIED: { label: 'VERIFIED', className: 'bg-green-600 text-white hover:bg-green-700' },
  BUG_PERSISTS: { label: 'BUG PERSISTS', className: 'bg-red-600 text-white hover:bg-red-700' },
  INCONCLUSIVE: { label: 'INCONCLUSIVE', className: 'bg-amber-500 text-white hover:bg-amber-600' },
};

function VerifyFixControl({
  status,
  disabled,
  disabledReason,
  onVerify,
}: {
  status: VerifyStatus;
  disabled: boolean;
  disabledReason?: string;
  onVerify: () => void;
}) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        <svg className="h-3.5 w-3.5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Verifying…
      </span>
    );
  }

  if (status !== 'idle') {
    const theme = VERDICT_THEME[status.verdict] ?? VERDICT_THEME.INCONCLUSIVE;
    return (
      <button
        type="button"
        onClick={onVerify}
        disabled={disabled}
        title={`${status.summary}${disabled && disabledReason ? ` — ${disabledReason}` : ' (click to re-verify)'}`}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${theme.className}`}
      >
        {theme.label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onVerify}
      disabled={disabled}
      title={disabled ? disabledReason : 'Replay this finding to check whether it is fixed'}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" />
      </svg>
      Verify Fix
    </button>
  );
}

function FindingCard({
  bug,
  index,
  sessionId,
  status,
  onVerify,
}: {
  bug: ForensicCaughtBug;
  index: number;
  sessionId?: string;
  status: VerifyStatus;
  onVerify: (request: VerifyFixRequest) => void;
}) {
  const [stackExpanded, setStackExpanded] = useState(false);
  const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
  const summaryText = useMemo(() => buildBugSummaryText(bug, index), [bug, index]);

  // A verifiable finding needs both a persisted session id and a stable bugId.
  const canVerify = Boolean(sessionId) && Boolean(bug.bugId);
  const disabledReason = !sessionId
    ? 'Missing session id for this report'
    : !bug.bugId
      ? 'This finding has no stable id to replay'
      : undefined;

  return (
    <div className="overflow-hidden rounded-lg border border-red-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
            {index + 1}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-red-900">{bugClass}</div>
            <div className="text-[11px] text-red-700 opacity-75">{formatDate(bug.timestamp)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <VerifyFixControl
            status={status}
            disabled={!canVerify || status === 'running'}
            disabledReason={disabledReason}
            onVerify={() => canVerify && sessionId && onVerify({ sessionId, bugId: bug.bugId })}
          />
          <CopyButton text={summaryText} label="Finding" />
        </div>
      </div>

      {/* Attribution */}
      <div className="px-4 pt-3">
        <AttributionBadges attribution={bug.attribution} />
      </div>

      {/* Message / Selector / Payload grid */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Message</div>
          <div className="mt-0.5 text-sm text-gray-800">{bug.message || 'No details provided'}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Selector</div>
          <div className="mt-0.5 truncate font-mono text-xs text-gray-700" title={bug.selector}>{bug.selector || 'N/A'}</div>
        </div>
        {bug.payloadUsed && (
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Payload Used</div>
            <div className="mt-0.5 truncate font-mono text-xs text-gray-700" title={bug.payloadUsed}>{bug.payloadUsed}</div>
          </div>
        )}
      </div>

      {/* Reproduction steps */}
      <div className="px-4 pt-3">
        {bug.reproductionSteps && bug.reproductionSteps.length > 0 ? (
          <ReproductionChecklist steps={bug.reproductionSteps} />
        ) : (
          <div className="rounded-md border border-gray-200 bg-gray-100 p-3 text-xs italic text-gray-400">
            No deterministic reproduction steps were recorded for this fault.
          </div>
        )}
      </div>

      {/* Suggested fix */}
      <div className="px-4 pt-3 pb-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">Suggested Fix</div>
        <SuggestedFixBlock advice={bug.advice} />
      </div>

      {/* Stack trace — kept as a disclosure since it's verbose/noisy evidence, not primary narrative */}
      {bug.stackTrace && (
        <ExpandableCodeBlock
          title="Stack Trace"
          content={bug.stackTrace}
          isExpanded={stackExpanded}
          onToggle={() => setStackExpanded((prev) => !prev)}
          className="max-h-96"
        />
      )}
    </div>
  );
}

function CleanRunCard() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-6 py-10 text-center">
      <span className="text-2xl">✅</span>
      <div className="text-sm font-semibold text-green-800">No findings were recorded for this session</div>
      <div className="text-xs text-green-700">The autonomous run completed without confirming any bugs or vulnerabilities.</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reference appendix — the full raw action timeline. This is
// supplementary, low-level evidence (not tied 1:1 to any single
// finding above), so it stays as a single de-emphasized disclosure
// at the bottom rather than a peer section competing for attention.
// ─────────────────────────────────────────────────────────────

function ActionTimelineAppendix({ steps }: { steps: ForensicActionStep[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!steps.length) return null;

  const timelineText = steps
    .map((step) => {
      const payload = step.payloadText ? ` with payload "${step.payloadText}"` : '';
      return `Step ${step.stepNumber}: ${step.actionType}${payload} on ${step.selector || 'N/A'} (${formatDate(step.timestamp)})`;
    })
    .join('\n');

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-100"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Full Action Timeline ({steps.length} steps) — reference
        </span>
        <span className="text-xs text-gray-400">{isOpen ? '▼ Collapse' : '▶ Expand'}</span>
      </button>
      {isOpen && (
        <div className="border-t border-gray-200 px-4 py-4">
          <div className="mb-3 flex justify-end">
            <CopyButton text={timelineText} label="Action Timeline" />
          </div>
          <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs text-gray-600">
            {steps.map((step) => (
              <li key={step.stepNumber} className="border-b border-gray-100 py-1 last:border-0">
                <span className="text-gray-400">#{step.stepNumber}</span>{' '}
                <span className="font-semibold text-gray-700">{step.actionType}</span>
                {step.payloadText ? <span> with "{step.payloadText}"</span> : null}
                {' on '}
                <span>{step.selector || 'N/A'}</span>
                <span className="text-gray-400"> ({formatDate(step.timestamp)})</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export default function ForensicReport() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [report, setReport] = useState<ForensicReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('Missing report ID.');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadReport = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchForensicReport(sessionId);
        if (!cancelled) {
          setReport(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load forensic report.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadReport();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const bugs = useMemo(() => report?.forensicTrace?.caughtBugs ?? [], [report]);
  const { statuses, verify } = useRegressionVerifier();

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-700">Loading forensic report…</div>
          <div className="mt-2 text-xs text-gray-500">Fetching the latest session details from the backend.</div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <div className="text-sm font-semibold text-red-600">Failed to load report</div>
          <div className="mt-2 text-xs text-gray-500">{error || 'No report data was returned for this session.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-gray-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-gray-900">BUGSAFARI</span>
          <span className="mx-3 text-gray-400">/</span>
          <span className="text-sm font-semibold text-gray-600">FORENSIC REPORT</span>
        </div>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to History
        </button>
      </header>

      {/* Report Body */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <ExecutiveSummary report={report} sessionId={sessionId || 'N/A'} />

          <AiInsightsPanel aiAnalysis={report.aiAnalysis} />

          <section>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-500">
              Findings {bugs.length > 0 ? `(${bugs.length})` : ''}
            </h2>
            {bugs.length > 0 ? (
              <div className="flex flex-col gap-4">
                {bugs.map((bug, index) => (
                  <FindingCard
                    key={bug.bugId || index}
                    bug={bug}
                    index={index}
                    sessionId={sessionId}
                    status={statuses[bug.bugId] ?? 'idle'}
                    onVerify={verify}
                  />
                ))}
              </div>
            ) : (
              <CleanRunCard />
            )}
          </section>

          <ActionTimelineAppendix steps={report.actionSteps ?? []} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white px-6 py-4">
        <div className="text-center">
          <span className="font-mono text-xs text-gray-400">END OF FORENSIC REPORT</span>
        </div>
      </footer>
    </div>
  );
}

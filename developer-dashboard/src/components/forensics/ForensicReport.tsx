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
import type {
  ForensicActionStep,
  ForensicCaughtBug,
  ForensicNetworkLog,
  ForensicConsoleLog,
  ForensicReportResponse,
  VerifyFixRequest,
  VerifyFixResult,
  RegressionVerdict,
  RegressionSignal,
} from '../../types';
import ReproductionChecklist from '../telemetry/ReproductionChecklist';
import { CoverageDisplay } from '../history/CoverageProgressBar';
import { AttributionBadges, CopyButton, ExpandableCodeBlock, SuggestedFixBlock } from '../common/ForensicCardKit';
import { Modal } from '../ui/Modal';
import {
  useRegressionVerifier,
  IDLE_VERIFY_STATUS,
  type VerifyStatus,
} from '../../application/useCases/useRegressionVerifier';

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
  if (status === 'CRASHED') return { text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-900' };
  if (status === 'HALTED') return { text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900' };
  return { text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-900' };
}

function riskTheme(score: number): string {
  if (score >= 70) return 'text-red-600 dark:text-red-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

// ─────────────────────────────────────────────────────────────
// Executive summary — always-visible stat grid (no accordion; this
// is the at-a-glance context every reader needs immediately).
// ─────────────────────────────────────────────────────────────

function StatBlock({ label, value, valueClassName = 'text-gray-900 dark:text-gray-100' }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-caption font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${valueClassName}`}>{value}</div>
    </div>
  );
}

function ExecutiveSummary({ report, sessionId, findingsCount }: { report: ForensicReportResponse; sessionId: string; findingsCount?: number }) {
  const theme = statusTheme(report.status);
  const [showRoutes, setShowRoutes] = useState(false);
  // Prefer the DISTINCT finding count (identical repeats collapsed) so the summary
  // matches the number of cards below; fall back to raw totals for legacy data.
  const findingsTotal = findingsCount && findingsCount > 0
    ? findingsCount
    : (report.findings?.totalBugsFound ?? report.metrics?.totalBugsFound ?? 0);

  const routes = report.visitedRoutes ?? [];
  const pagesVisited = report.pagesVisited ?? routes.length;

  return (
    <section className={`rounded-xl border ${theme.border} ${theme.bg} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
            <span className={`text-sm font-bold uppercase tracking-wide ${theme.text}`}>{report.status || 'UNKNOWN'}</span>
          </div>
          <div className="mt-1 truncate text-sm font-medium text-gray-700 dark:text-gray-300" title={report.url}>{report.url || 'N/A'}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>Run {sessionId}</span>
            <span>•</span>
            <span>Started {formatDate(report.date)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-200/70 pt-4 sm:grid-cols-3 lg:grid-cols-6 dark:border-gray-700/70">
        <StatBlock label="Duration" value={formatDuration(report.duration)} />
        <StatBlock label="Actions" value={report.metrics?.totalActions ?? 0} />
        <StatBlock label="Findings" value={findingsTotal} valueClassName={findingsTotal > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'} />
        <StatBlock label="Pages" value={pagesVisited} />
        <StatBlock label="Risk Score" value={report.riskScore ?? 0} valueClassName={riskTheme(report.riskScore ?? 0)} />
        <StatBlock label="Coverage" value={<CoverageDisplay percentage={report.coverage ?? 0} />} />
      </div>

      {routes.length > 0 && (
        <div className="mt-4 border-t border-gray-200/70 pt-3 dark:border-gray-700/70">
          <button
            type="button"
            onClick={() => setShowRoutes((prev) => !prev)}
            className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <span>{showRoutes ? '▼' : '▶'}</span>
            <span>Visited Routes ({routes.length})</span>
          </button>
          {showRoutes && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-gray-600 dark:text-gray-400">
              {routes.map((route, idx) => (
                <li key={idx} className="truncate border-b border-gray-100 py-1 last:border-0 dark:border-gray-800" title={route}>{route}</li>
              ))}
            </ul>
          )}
        </div>
      )}
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
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
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
              <span className="text-blue-500 dark:text-blue-400">→</span>
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

// Human-readable action target — bare "N/A" (navigation / page-level steps carry no
// DOM selector) reads badly in a report, so map it to intent per actionType.
function stepTarget(step: ForensicActionStep): string {
  const s = step.selector;
  if (step.actionType === 'navigation') return s && s !== 'N/A' ? s : 'page navigation';
  return s && s !== 'N/A' ? s : 'page-level (no element)';
}

// One-line rendering of a step, shared by the plaintext copy paths.
function stepLine(step: ForensicActionStep): string {
  const payload = step.payloadText ? ` with "${step.payloadText}"` : '';
  return `#${step.stepNumber} ${step.actionType}${payload} on ${stepTarget(step)}`;
}

// Ordered structured trace, shared by the per-finding block and the session appendix.
function ActionStepList({ steps }: { steps: ForensicActionStep[] }) {
  return (
    <ol className="max-h-96 space-y-1 overflow-y-auto font-mono text-xs text-gray-600 dark:text-gray-400">
      {steps.map((step) => (
        <li key={step.stepNumber} className="border-b border-gray-100 py-1 last:border-0 dark:border-gray-800">
          <span className="text-gray-400 dark:text-gray-500">#{step.stepNumber}</span>{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-300">{step.actionType}</span>
          {step.payloadText ? <span> with "{step.payloadText}"</span> : null}
          {' on '}
          <span>{stepTarget(step)}</span>
          {typeof step.durationMs === 'number' && <span className="text-gray-400 dark:text-gray-500"> ({step.durationMs}ms)</span>}
          <span className="text-gray-400 dark:text-gray-500"> ({formatDate(step.timestamp)})</span>
        </li>
      ))}
    </ol>
  );
}

function buildBugSummaryText(bug: ForensicCaughtBug, index: number): string {
  const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
  return [
    `Finding #${index}: ${bugClass}`,
    bug.message ? `Message: ${bug.message}` : '',
    bug.selector ? `Selector: ${bug.selector}` : '',
    bug.payloadUsed ? `Payload: ${bug.payloadUsed}` : '',
    `Detected: ${formatDate(bug.timestamp)}`,
    bug.advice ? `\nSuggested Fix:\n${bug.advice}` : '',
    bug.actionSteps?.length ? `\nReproduction Trace:\n${bug.actionSteps.map(stepLine).join('\n')}` : '',
    bug.reproductionSteps?.length ? `\nReproduction Steps:\n${bug.reproductionSteps.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────
// Verify Fix — per-finding regression replay control + result modal.
// The control renders the whole lifecycle: an idle trigger → a live
// progress pill (replaying N/total → validating) → a settled verdict
// badge (RESOLVED / STILL ACTIVE / INCONCLUSIVE) that reopens a
// dedicated result modal. The finding card itself also re-themes to
// the settled verdict so a reader sees at a glance whether the defect
// is fixed. Phase data is streamed from the engine over the socket.
// ─────────────────────────────────────────────────────────────

type VerdictIcon = (className: string) => ReactNode;

const checkIcon: VerdictIcon = (c) => (
  <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);
const alertIcon: VerdictIcon = (c) => (
  <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L14.7 3.86a2 2 0 00-3.4 0z" />
  </svg>
);
const questionIcon: VerdictIcon = (c) => (
  <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.2 9a3.8 3.8 0 017.4 1.3c0 2.5-3.8 3.2-3.8 3.2M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

interface VerdictMeta {
  label: string;
  badge: string;
  chip: string;
  dot: string;
  cardBorder: string;
  cardHeaderBg: string;
  cardTitle: string;
  cardSub: string;
  numberBg: string;
  modalBar: string;
  icon: VerdictIcon;
}

const VERDICT_META: Record<RegressionVerdict, VerdictMeta> = {
  RESOLVED: {
    label: 'Resolved',
    badge: 'bg-green-600 text-white hover:bg-green-700',
    chip: 'bg-green-100 text-green-800 border border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800',
    dot: 'bg-green-500',
    cardBorder: 'border-green-200 dark:border-green-800',
    cardHeaderBg: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800',
    cardTitle: 'text-green-900 dark:text-green-300',
    cardSub: 'text-green-700 dark:text-green-400',
    numberBg: 'bg-green-600',
    modalBar: 'bg-green-600',
    icon: checkIcon,
  },
  STILL_ACTIVE: {
    label: 'Still Active',
    badge: 'bg-red-600 text-white hover:bg-red-700',
    chip: 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
    dot: 'bg-red-500',
    cardBorder: 'border-red-300 dark:border-red-800',
    cardHeaderBg: 'bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-800',
    cardTitle: 'text-red-900 dark:text-red-300',
    cardSub: 'text-red-700 dark:text-red-400',
    numberBg: 'bg-red-600',
    modalBar: 'bg-red-600',
    icon: alertIcon,
  },
  INCONCLUSIVE: {
    label: 'Inconclusive',
    badge: 'bg-amber-500 text-white hover:bg-amber-600',
    chip: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    dot: 'bg-amber-500',
    cardBorder: 'border-amber-200 dark:border-amber-800',
    cardHeaderBg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
    cardTitle: 'text-amber-900 dark:text-amber-300',
    cardSub: 'text-amber-700 dark:text-amber-400',
    numberBg: 'bg-amber-500',
    modalBar: 'bg-amber-500',
    icon: questionIcon,
  },
};

// Base (unverified) finding theme — the existing red "confirmed bug" look.
const BASE_CARD = {
  cardBorder: 'border-red-200 dark:border-red-900',
  cardHeaderBg: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900',
  cardTitle: 'text-red-900 dark:text-red-300',
  cardSub: 'text-red-700 dark:text-red-400',
  numberBg: 'bg-red-600',
};

function verdictMetaOf(verdict: RegressionVerdict): VerdictMeta {
  return VERDICT_META[verdict] ?? VERDICT_META.INCONCLUSIVE;
}

/** Human phase label for the running pill (real per-step counts when known). */
function phaseLabel(status: Extract<VerifyStatus, { state: 'running' }>): string {
  if (status.phase === 'validating') return 'Validating…';
  if (status.totalSteps > 0) return `Replaying ${status.stepsReplayed}/${status.totalSteps}…`;
  return 'Replaying…';
}

function VerifyFixControl({
  status,
  disabled,
  disabledReason,
  onVerify,
  onOpenResult,
}: {
  status: VerifyStatus;
  disabled: boolean;
  disabledReason?: string;
  onVerify: () => void;
  onOpenResult: () => void;
}) {
  if (status.state === 'running') {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-400"
        aria-live="polite"
      >
        <svg className="h-3.5 w-3.5 animate-spin text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        {phaseLabel(status)}
      </span>
    );
  }

  if (status.state === 'done') {
    const meta = verdictMetaOf(status.result.verdict);
    return (
      <button
        type="button"
        onClick={onOpenResult}
        title="View verification result"
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${meta.badge}`}
      >
        {meta.icon('h-3.5 w-3.5')}
        {meta.label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onVerify}
      disabled={disabled}
      title={disabled ? disabledReason : 'Replay this finding to check whether it is fixed'}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" />
      </svg>
      Verify Fix
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Verification Result Modal — the dedicated outcome surface. Shows
// the verdict, the engine's summary, run metadata, and (for a
// STILL_ACTIVE verdict) the exact console/network signals that
// reproduced the original fault.
// ─────────────────────────────────────────────────────────────

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</div>
      <div className="mt-0.5 truncate text-xs font-bold text-gray-900 dark:text-gray-100" title={value}>{value}</div>
    </div>
  );
}

function ReproducedSignal({ signal }: { signal: RegressionSignal }) {
  return (
    <li className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
      <div className="flex items-center gap-2">
        <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          {signal.faultType}
        </span>
        {typeof signal.statusCode === 'number' && (
          <span className="font-mono text-[11px] font-semibold text-red-700 dark:text-red-400">HTTP {signal.statusCode}</span>
        )}
      </div>
      <div className="mt-1 break-words text-xs text-gray-800 dark:text-gray-200">{signal.message}</div>
      {signal.url && (
        <div className="mt-1 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400" title={signal.url}>{signal.url}</div>
      )}
    </li>
  );
}

function VerificationResultModal({
  result,
  onReverify,
  onClose,
}: {
  result: VerifyFixResult;
  onReverify: () => void;
  onClose: () => void;
}) {
  const meta = verdictMetaOf(result.verdict);
  const titleId = `verify-result-${result.bugId}`;

  return (
    <Modal isOpen onClose={onClose} titleId={titleId} maxWidthClassName="max-w-lg">
      {/* Accent header keyed to the verdict tone */}
      <div className={`flex items-center gap-3 rounded-t-lg px-5 py-4 text-white ${meta.modalBar}`}>
        {meta.icon('h-6 w-6 shrink-0')}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-90">Verification Result</div>
          <h2 id={titleId} className="text-lg font-bold leading-tight">{meta.label}</h2>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-y-auto bg-white px-5 py-4 dark:bg-nova-dark">
        <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">{result.summary}</p>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <ResultStat label="Bug Class" value={result.bugClass || 'UNKNOWN'} />
          <ResultStat label="Steps Replayed" value={String(result.stepsReplayed)} />
          <ResultStat label="Duration" value={formatDuration(result.durationMs)} />
        </div>

        {result.verdict === 'STILL_ACTIVE' && result.matchedSignals.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Reproduced Signals ({result.matchedSignals.length})
            </div>
            <ul className="space-y-2">
              {result.matchedSignals.map((signal, idx) => (
                <ReproducedSignal key={idx} signal={signal} />
              ))}
            </ul>
          </div>
        )}

        {result.verdict === 'RESOLVED' && (
          <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300">
            The recorded reproduction timeline replayed cleanly — none of the original fault's signals recurred.
          </div>
        )}

        {result.verdict === 'INCONCLUSIVE' && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {result.error || 'The replay could not run to completion, so this verdict is not trustworthy. Try again.'}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 rounded-b-lg border-t border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-nova-dark">
        <button
          type="button"
          onClick={onReverify}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12a8 8 0 11-2.3-5.6M20 4v4h-4" />
          </svg>
          Re-verify
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

function FindingCard({
  bug,
  index,
  occurrences = 1,
  sessionId,
  status,
  onVerify,
}: {
  bug: ForensicCaughtBug;
  index: number;
  occurrences?: number;
  sessionId?: string;
  status: VerifyStatus;
  onVerify: (request: VerifyFixRequest) => void;
}) {
  const [stackExpanded, setStackExpanded] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
  const summaryText = useMemo(() => buildBugSummaryText(bug, index), [bug, index]);

  // A verifiable finding needs both a persisted session id and a stable bugId.
  const canVerify = Boolean(sessionId) && Boolean(bug.bugId);
  const disabledReason = !sessionId
    ? 'Missing session id for this report'
    : !bug.bugId
      ? 'This finding has no stable id to replay'
      : undefined;

  // Settled verdict drives both the card theme and the header status chip.
  const settled = status.state === 'done' ? status.result : null;
  const verdictMeta = settled ? verdictMetaOf(settled.verdict) : null;
  const theme = verdictMeta ?? BASE_CARD;

  const triggerVerify = (): void => {
    if (canVerify && sessionId) onVerify({ sessionId, bugId: bug.bugId });
  };

  // Surface the outcome immediately: pop the result modal whenever a fresh
  // terminal result arrives (initial verify or any re-verify → a new object).
  useEffect(() => {
    if (settled) setShowResult(true);
  }, [settled]);

  return (
    <div className={`overflow-hidden rounded-lg border ${theme.cardBorder} bg-white shadow-sm dark:bg-slate-900`}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 border-b ${theme.cardHeaderBg} px-4 py-3`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${theme.numberBg} text-xs font-bold text-white`}>
            {index}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`truncate text-sm font-bold ${theme.cardTitle}`}>{bugClass}</span>
              {occurrences > 1 && (
                <span
                  title={`This fault occurred ${occurrences} times this session`}
                  className="inline-flex shrink-0 items-center rounded-full bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-white"
                >
                  ×{occurrences}
                </span>
              )}
              {verdictMeta && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${verdictMeta.chip}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${verdictMeta.dot}`} />
                  {verdictMeta.label}
                </span>
              )}
            </div>
            <div className={`text-[11px] opacity-75 ${theme.cardSub}`}>{formatDate(bug.timestamp)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <VerifyFixControl
            status={status}
            disabled={!canVerify || status.state === 'running'}
            disabledReason={disabledReason}
            onVerify={triggerVerify}
            onOpenResult={() => setShowResult(true)}
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
          <div className="text-caption font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Message</div>
          <div className="mt-0.5 text-sm text-gray-800 dark:text-gray-200">{bug.message || 'No details provided'}</div>
        </div>
        <div className="min-w-0">
          <div className="text-caption font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Selector</div>
          <div className="mt-0.5 truncate font-mono text-xs text-gray-700 dark:text-gray-300" title={bug.selector}>{bug.selector || 'N/A'}</div>
        </div>
        {bug.payloadUsed && (
          <div className="min-w-0">
            <div className="text-caption font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Payload Used</div>
            <div className="mt-0.5 truncate font-mono text-xs text-gray-700 dark:text-gray-300" title={bug.payloadUsed}>{bug.payloadUsed}</div>
          </div>
        )}
      </div>

      {/* Reproduction steps — prefer the structured, replayable trace (same timeline
          Verify Fix replays); fall back to the prose checklist, then the empty message. */}
      <div className="px-4 pt-3">
        {bug.actionSteps && bug.actionSteps.length > 0 ? (
          <div>
            <div className="mb-2 text-caption font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Reproduction Trace ({bug.actionSteps.length} steps)
            </div>
            <ActionStepList steps={bug.actionSteps} />
          </div>
        ) : bug.reproductionSteps && bug.reproductionSteps.length > 0 ? (
          <ReproductionChecklist steps={bug.reproductionSteps} />
        ) : (
          <div className="rounded-md border border-gray-200 bg-gray-100 p-3 text-xs italic text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
            No deterministic reproduction steps were recorded for this fault.
          </div>
        )}
      </div>

      {/* Suggested fix */}
      <div className="px-4 pt-3 pb-4">
        <div className="mb-2 text-caption font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Suggested Fix</div>
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

      {/* Dedicated verification outcome surface (auto-opens on completion) */}
      {settled && showResult && (
        <VerificationResultModal
          result={settled}
          onReverify={() => {
            setShowResult(false);
            triggerVerify();
          }}
          onClose={() => setShowResult(false)}
        />
      )}
    </div>
  );
}

function CleanRunCard() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-6 py-10 text-center dark:border-green-900 dark:bg-green-950/20">
      <span className="text-2xl">✅</span>
      <div className="text-sm font-semibold text-green-800 dark:text-green-300">No findings were recorded for this session</div>
      <div className="text-xs text-green-700 dark:text-green-400">The autonomous run completed without confirming any bugs or vulnerabilities.</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reference appendix — the full raw action timeline. This is
// supplementary, low-level evidence (not tied 1:1 to any single
// finding above), so it stays as a single de-emphasized disclosure
// at the bottom rather than a peer section competing for attention.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Tabbed panels — mirror the live dashboard's right-panel tabs
// (Findings / Network / Console) so a saved session rehydrates the same
// categorized context the operator saw live. Network/Console now persist the
// FULL streams (every request, every console level), matching the live tabs.
// The *_ERROR_TYPES sets below only drive the legacy fallback for old sessions
// saved before full-log persistence existed.
// ─────────────────────────────────────────────────────────────

const NETWORK_ERROR_TYPES = new Set(['API_FAILURE', 'NAVIGATION_FAILURE', 'TIMEOUT_FAILURE']);
const CONSOLE_ERROR_TYPES = new Set(['CONSOLE_ERROR', 'CONSOLE_WARN', 'JS_EXCEPTION', 'UNHANDLED_REJECTION']);

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] leading-none text-gray-700 dark:bg-gray-700 dark:text-gray-300">
      {count > 999 ? '999+' : count}
    </span>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100'
          : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
      }`}
    >
      {label}
      <TabCount count={count} />
    </button>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-8 text-center text-xs italic text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
      {message}
    </div>
  );
}

// Full network log — every request (incl. successful), mirroring the live Network tab.
function statusTint(row: ForensicNetworkLog): { border: string; bg: string; status: string } {
  const code = row.statusCode ?? 0;
  if (!row.ok || code >= 500) return { border: 'border-red-200 dark:border-red-900', bg: 'bg-red-50 dark:bg-red-950/30', status: 'text-red-700 dark:text-red-400' };
  if (code >= 400) return { border: 'border-amber-200 dark:border-amber-900', bg: 'bg-amber-50 dark:bg-amber-950/30', status: 'text-amber-700 dark:text-amber-400' };
  return { border: 'border-gray-200 dark:border-gray-700', bg: 'bg-white dark:bg-slate-900', status: 'text-green-700 dark:text-green-400' };
}

function NetworkLogList({ rows }: { rows: ForensicNetworkLog[] }) {
  if (!rows.length) return <EmptyTab message="No network requests were recorded for this session." />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => {
        const tint = statusTint(row);
        return (
          <li key={i} className={`rounded-md border ${tint.border} ${tint.bg} p-3`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white">{row.method}</span>
              <span className={`font-mono text-[11px] font-bold ${tint.status}`}>{row.ok || row.statusCode ? `HTTP ${row.statusCode ?? '—'}` : 'FAILED'}</span>
              {row.resourceType && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{row.resourceType}</span>
              )}
              {row.repeatCount && row.repeatCount > 1 && (
                <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">×{row.repeatCount}</span>
              )}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-gray-600 dark:text-gray-400" title={row.url}>{row.url}</div>
            {row.message && !row.ok && <div className="mt-1 break-words text-xs text-gray-800 dark:text-gray-200">{row.message}</div>}
          </li>
        );
      })}
    </ul>
  );
}

const CONSOLE_LEVEL_STYLES: Record<string, string> = {
  error: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  debug: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300',
  trace: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  notice: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  log: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

// Full console log — every level, mirroring the live Console tab.
function ConsoleLogList({ rows }: { rows: ForensicConsoleLog[] }) {
  if (!rows.length) return <EmptyTab message="No console output was recorded for this session." />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li key={i} className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${CONSOLE_LEVEL_STYLES[row.level] ?? CONSOLE_LEVEL_STYLES.log}`}>{row.level}</span>
            {row.url && <span className="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500" title={row.url}>{row.url}</span>}
          </div>
          {row.message && <div className="mt-1 break-words font-mono text-[11px] text-gray-800 dark:text-gray-200">{row.message}</div>}
          {row.stackTrace && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-900 p-2 font-mono text-[10px] leading-relaxed text-gray-200">{row.stackTrace}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}

function ActionTimelineAppendix({ steps }: { steps: ForensicActionStep[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!steps.length) return null;

  const timelineText = steps.map(stepLine).join('\n');

  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-slate-900">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Full Action Timeline ({steps.length} steps) — reference
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{isOpen ? '▼ Collapse' : '▶ Expand'}</span>
      </button>
      {isOpen && (
        <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
          <div className="mb-3 flex justify-end">
            <CopyButton text={timelineText} label="Action Timeline" />
          </div>
          <ActionStepList steps={steps} />
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
  // Collapse identical repeats (same fault registered per-occurrence) into one
  // card with an ×N count — lossless: every stored instance is still on `bugs`.
  // Findings are deduped server-side at save (each bug carries an `occurrences` count),
  // so render the caughtBugs directly. WCAG findings are ephemeral (never persisted);
  // the filter only guards legacy sessions saved before that change.
  const runtimeBugs = useMemo(() => bugs.filter((b) => b.type !== 'ACCESSIBILITY'), [bugs]);
  // Full network / console logs mirror the live tabs. New saves carry the complete
  // streams; legacy sessions (no logs) fall back to the persisted fault rows.
  const reportErrors = useMemo(() => report?.errorLogs?.errors ?? [], [report]);
  const networkRows = useMemo<ForensicNetworkLog[]>(() => {
    if (Array.isArray(report?.networkLog)) return report!.networkLog;
    return reportErrors
      .filter((e) => e.type && NETWORK_ERROR_TYPES.has(e.type))
      .map((e) => ({ timestamp: e.createdAt ?? '', method: e.method ?? 'GET', url: e.endpoint || e.url || '', statusCode: e.statusCode, ok: false, message: e.message }));
  }, [report, reportErrors]);
  const consoleRows = useMemo<ForensicConsoleLog[]>(() => {
    if (Array.isArray(report?.consoleLog)) return report!.consoleLog;
    return reportErrors
      .filter((e) => e.type && CONSOLE_ERROR_TYPES.has(e.type))
      .map((e) => ({ timestamp: e.createdAt ?? '', level: 'error' as const, type: e.type ?? 'CONSOLE', message: e.message ?? '', stackTrace: e.stackTrace }));
  }, [report, reportErrors]);
  const [activeTab, setActiveTab] = useState<'findings' | 'network' | 'console'>('findings');
  const { statuses, verify } = useRegressionVerifier();

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-slate-900">
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Loading forensic report…</div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Fetching the latest session details from the backend.</div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white px-6 dark:bg-slate-900">
        <div className="max-w-md text-center">
          <div className="text-sm font-semibold text-red-600 dark:text-red-400">Failed to load report</div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{error || 'No report data was returned for this session.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-slate-900">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-gray-900 dark:text-gray-100">BUGSAFARI</span>
          <span className="mx-3 text-gray-400 dark:text-gray-600">/</span>
          <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">FORENSIC REPORT</span>
        </div>
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
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
          <ExecutiveSummary report={report} sessionId={sessionId || 'N/A'} findingsCount={runtimeBugs.length} />

          <AiInsightsPanel aiAnalysis={report.aiAnalysis} />

          {/* Tabbed panels — same categorized layout as the live execution. */}
          <section>
            <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-gray-700">
              <TabButton label="Findings" count={runtimeBugs.length} active={activeTab === 'findings'} onClick={() => setActiveTab('findings')} />
              <TabButton label="Network" count={networkRows.length} active={activeTab === 'network'} onClick={() => setActiveTab('network')} />
              <TabButton label="Console" count={consoleRows.length} active={activeTab === 'console'} onClick={() => setActiveTab('console')} />
            </div>

            {activeTab === 'findings' && (
              runtimeBugs.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {runtimeBugs.map((bug, index) => (
                    <FindingCard
                      key={bug.bugId || index}
                      bug={bug}
                      index={index}
                      occurrences={bug.occurrences ?? 1}
                      sessionId={sessionId}
                      status={statuses[bug.bugId] ?? IDLE_VERIFY_STATUS}
                      onVerify={verify}
                    />
                  ))}
                </div>
              ) : (
                <CleanRunCard />
              )
            )}
            {activeTab === 'network' && <NetworkLogList rows={networkRows} />}
            {activeTab === 'console' && <ConsoleLogList rows={consoleRows} />}
          </section>

          <ActionTimelineAppendix steps={report.actionSteps ?? []} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-slate-900">
        <div className="text-center">
          <span className="font-mono text-xs text-gray-400 dark:text-gray-600">END OF FORENSIC REPORT</span>
        </div>
      </footer>
    </div>
  );
}

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
import { Check, TriangleAlert, CircleHelp, CircleX, RefreshCcw, Lightbulb, LoaderCircle, RefreshCw, ArrowLeft, CircleCheckBig, Bug } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useHistoryStore } from '../../stores/history/historyStore';
import type {
  ForensicActionStep,
  ForensicCaughtBug,
  ForensicNetworkLog,
  ForensicConsoleLog,
  ForensicReportResponse,
  VerifyFixRequest,
  VerifyFixResult,
  VerifyFixReason,
  RegressionVerdict,
  RegressionSignal,
} from '../../types';
import {
  actionStepsToMarkdown,
  splitObservations,
  toMarkdownChecklist,
} from '../../utils/reproductionFormat';
import { CoverageDisplay } from '../history/CoverageProgressBar';
import { CopyButton, SeverityBadge } from '../common/ForensicCardKit';
import { formatReportDate, formatReportDateTime } from '../../utils/datetime';
import { TerminationBadge, outcomeFromStatus } from '../common/TerminationBadge';
import { isCleanTermination } from '../../types';
import FindingEvidence, { ActionStepList } from '../common/FindingEvidence';
import { caughtBugToFindingView } from '../../utils/findingView';
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

// Themed off the resolved outcome, not the raw string: the backend sends DB
// SessionStatus values ('Crashed'), so the old uppercase comparisons never matched
// and every report — including crashes — rendered with the stable/green theme.
function statusTheme(status: string): { text: string; dot: string; bg: string; border: string } {
  const outcome = outcomeFromStatus(status);
  if (outcome && !isCleanTermination(outcome)) {
    return outcome === 'graceful-shutdown' || outcome === 'abandoned'
      ? { text: 'text-(--status-warning-fg)', dot: 'bg-(--status-warning-fg)', bg: 'bg-(--status-warning-bg)', border: 'border-(--status-warning-border)' }
      : { text: 'text-(--status-critical-fg)', dot: 'bg-(--status-critical-fg)', bg: 'bg-(--status-critical-bg)', border: 'border-(--status-critical-border)' };
  }
  return { text: 'text-(--status-stable-fg)', dot: 'bg-(--status-stable-fg)', bg: 'bg-(--status-stable-bg)', border: 'border-(--status-stable-border)' };
}

function riskTheme(score: number): string {
  if (score >= 70) return 'text-(--status-critical-fg)';
  if (score >= 40) return 'text-(--status-warning-fg)';
  return 'text-(--status-stable-fg)';
}

// ─────────────────────────────────────────────────────────────
// Executive summary — always-visible stat grid (no accordion; this
// is the at-a-glance context every reader needs immediately).
// ─────────────────────────────────────────────────────────────

function StatBlock({ label, value, valueClassName = 'text-(--text-primary)' }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-caption font-semibold uppercase tracking-wider text-(--text-secondary)">{label}</div>
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
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="text-caption font-semibold uppercase tracking-wider text-(--text-tertiary)">Target</div>
          <div className="mt-1 truncate text-lg font-bold text-(--text-primary)" title={report.url}>{report.url || 'N/A'}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-(--text-tertiary)">
            <span className="font-mono">Run {sessionId}</span>
            <span aria-hidden="true">•</span>
            <span>{formatReportDateTime(report.date)}</span>
            {report.endedReason && (
              <>
                <span aria-hidden="true">•</span>
                <span className="text-(--text-secondary)">{report.endedReason}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {report.outcome || outcomeFromStatus(report.status) ? (
            <TerminationBadge outcome={report.outcome} status={report.status} reason={report.endedReason} />
          ) : (
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${theme.bg}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${theme.dot}`} />
              <span className={`text-[13px] font-bold uppercase tracking-wide ${theme.text}`}>{report.status || 'UNKNOWN'}</span>
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-(--border-hairline) pt-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatBlock label="Duration" value={formatDuration(report.duration)} />
        <StatBlock label="Actions" value={report.metrics?.totalActions ?? 0} />
        <StatBlock label="Findings" value={findingsTotal} valueClassName={findingsTotal > 0 ? 'text-(--status-critical-fg)' : 'text-(--status-stable-fg)'} />
        <StatBlock label="Pages" value={pagesVisited} />
        <StatBlock label="Risk Score" value={report.riskScore ?? 0} valueClassName={riskTheme(report.riskScore ?? 0)} />
        <StatBlock label="Coverage" value={<CoverageDisplay percentage={report.coverage ?? 0} />} />
      </div>

      {routes.length > 0 && (
        <div className="mt-4 border-t border-(--border-hairline) pt-3">
          <button
            type="button"
            onClick={() => setShowRoutes((prev) => !prev)}
            className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wider text-(--text-secondary) transition-colors hover:text-(--text-primary)"
          >
            <span>{showRoutes ? '▼' : ''}</span>
            <span>Visited Routes ({routes.length})</span>
          </button>
          {showRoutes && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-(--text-secondary)">
              {routes.map((route, idx) => (
                <li key={idx} className="truncate border-b border-(--border-hairline) py-1 last:border-0" title={route}>{route}</li>
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
    <section className="rounded-lg border border-(--status-neutral-border) bg-(--status-neutral-bg) p-5">
      <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-(--status-neutral-fg)">
        <Lightbulb className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span>AI Insights</span>
        {aiAnalysis.riskLevel && (
          <span className="rounded-full bg-(--surface-raised) px-2 py-0.5 text-[11px] font-semibold uppercase text-(--status-neutral-fg)">
            {aiAnalysis.riskLevel} risk
          </span>
        )}
      </div>
      {aiAnalysis.rootCause && (
        <p className="mt-3 text-sm leading-relaxed text-(--text-primary)">{aiAnalysis.rootCause}</p>
      )}
      {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {aiAnalysis.recommendations.map((recommendation, idx) => (
            <li key={idx} className="flex gap-2 text-[13px] text-(--text-secondary)">
              <span className="text-(--status-neutral-fg)">→</span>
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

// ActionStepList (the structured, per-step trace) is shared with the live Errors
// tab via ../common/FindingEvidence — imported above, reused here in the appendix.

function buildBugSummaryText(bug: ForensicCaughtBug, index: number): string {
  const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
  const { steps: narrativeSteps, observations } = splitObservations(bug.reproductionSteps ?? []);
  const reproMarkdown = bug.actionSteps?.length
    ? actionStepsToMarkdown(bug.actionSteps)
    : toMarkdownChecklist(narrativeSteps, []);
  return [
    `Finding #${index + 1}: ${bugClass}`,
    bug.message ? `Message: ${bug.message}` : '',
    bug.selector ? `Selector: ${bug.selector}` : '',
    bug.payloadUsed ? `Payload: ${bug.payloadUsed}` : '',
    `Detected: ${formatReportDateTime(bug.timestamp)}`,
    bug.advice ? `\nSuggested Fix:\n${bug.advice}` : '',
    reproMarkdown ? `\nReproduction Steps:\n${reproMarkdown}` : '',
    observations.length ? `\nObserved:\n${observations.map((o) => `> ${o}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────
// Verify Fix — per-finding regression replay control + result modal.
// The control renders the whole lifecycle: an idle trigger → a live
// progress pill (replaying N/total → validating) → a settled verdict
// badge (RESOLVED / STILL ACTIVE / INCONCLUSIVE / VERIFICATION FAILED) that reopens a
// dedicated result modal. The finding card itself also re-themes to
// the settled verdict so a reader sees at a glance whether the defect
// is fixed. Phase data is streamed from the engine over the socket.
// ─────────────────────────────────────────────────────────────

type VerdictIcon = (className: string) => ReactNode;

const checkIcon: VerdictIcon = (c) => (
  <Check className={c} strokeWidth={1.75} aria-hidden="true" />
);
const alertIcon: VerdictIcon = (c) => (
  <TriangleAlert className={c} strokeWidth={1.75} aria-hidden="true" />
);
const questionIcon: VerdictIcon = (c) => (
  <CircleHelp className={c} strokeWidth={1.75} aria-hidden="true" />
);
const xIcon: VerdictIcon = (c) => (
  <CircleX className={c} strokeWidth={1.75} aria-hidden="true" />
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
    badge: 'bg-(--status-stable-fg) text-(--text-oninvert) hover:opacity-90',
    chip: 'bg-(--status-stable-bg) text-(--status-stable-fg) border border-(--status-stable-border)',
    dot: 'bg-(--status-stable-fg)',
    cardBorder: 'border-(--status-stable-border)',
    cardHeaderBg: 'bg-(--status-stable-bg) border-(--status-stable-border)',
    cardTitle: 'text-(--status-stable-fg)',
    cardSub: 'text-(--status-stable-fg)',
    numberBg: 'bg-(--status-stable-fg)',
    modalBar: 'bg-(--status-stable-fg)',
    icon: checkIcon,
  },
  STILL_ACTIVE: {
    label: 'Still Active',
    badge: 'bg-(--status-critical-fg) text-(--text-oninvert) hover:opacity-90',
    chip: 'bg-(--status-critical-bg) text-(--status-critical-fg) border border-(--status-critical-border)',
    dot: 'bg-(--status-critical-fg)',
    cardBorder: 'border-(--status-critical-border)',
    cardHeaderBg: 'bg-(--status-critical-bg) border-(--status-critical-border)',
    cardTitle: 'text-(--status-critical-fg)',
    cardSub: 'text-(--status-critical-fg)',
    numberBg: 'bg-(--status-critical-fg)',
    modalBar: 'bg-(--status-critical-fg)',
    icon: alertIcon,
  },
  INCONCLUSIVE: {
    label: 'Inconclusive',
    badge: 'bg-(--status-warning-fg) text-(--text-oninvert) hover:opacity-90',
    chip: 'bg-(--status-warning-bg) text-(--status-warning-fg) border border-(--status-warning-border)',
    dot: 'bg-(--status-warning-fg)',
    cardBorder: 'border-(--status-warning-border)',
    cardHeaderBg: 'bg-(--status-warning-bg) border-(--status-warning-border)',
    cardTitle: 'text-(--status-warning-fg)',
    cardSub: 'text-(--status-warning-fg)',
    numberBg: 'bg-(--status-warning-fg)',
    modalBar: 'bg-(--status-warning-fg)',
    icon: questionIcon,
  },
  VERIFICATION_FAILED: {
    label: 'Verification Failed',
    badge: 'bg-(--status-warning-fg) text-(--text-oninvert) hover:opacity-90',
    chip: 'bg-(--status-warning-bg) text-(--status-warning-fg) border border-(--status-warning-border)',
    dot: 'bg-(--status-warning-fg)',
    cardBorder: 'border-(--status-warning-border)',
    cardHeaderBg: 'bg-(--status-warning-bg) border-(--status-warning-border)',
    cardTitle: 'text-(--status-warning-fg)',
    cardSub: 'text-(--status-warning-fg)',
    numberBg: 'bg-(--status-warning-fg)',
    modalBar: 'bg-(--status-warning-fg)',
    icon: xIcon,
  },
};

// Operator-facing explanation for each non-terminal-proof reason.
const REASON_TEXT: Record<VerifyFixReason, string> = {
  REPRODUCED: 'The original fault recurred during replay — the defect is still present.',
  CLEAN_REPLAY: 'The recorded reproduction timeline replayed cleanly — none of the original fault’s signals recurred.',
  INSUFFICIENT_REPLAY:
    'Too few of the recorded steps actually executed (selectors may have changed), so a clean run does not prove the fix.',
  UNVERIFIABLE_BUG_CLASS:
    'This bug class cannot be evidenced by deterministic replay. Re-test it with a live exploration run.',
  WEAK_MATCH_ONLY:
    'Faults of the same class occurred but could not be corroborated as the original defect — not enough evidence either way.',
  LEGACY_TIMELINE:
    'This finding predates per-finding timelines; the session-wide replay may never reach the faulting state, so a clean run is not proof.',
  REPLAY_ERROR: 'The target could not be replayed — this verdict says nothing about the bug. Try again.',
};

// Base (unverified) finding theme — the existing "confirmed bug" look, mapped to critical status tokens.
const BASE_CARD = {
  cardBorder: 'border-(--status-critical-border)',
  cardHeaderBg: 'bg-(--status-critical-bg) border-(--status-critical-border)',
  cardTitle: 'text-(--status-critical-fg)',
  cardSub: 'text-(--status-critical-fg)',
  numberBg: 'bg-(--status-critical-fg)',
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
        className="inline-flex items-center gap-2 rounded-md bg-(--surface-inset) px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--text-secondary)"
        aria-live="polite"
      >
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
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
      className="inline-flex items-center gap-1.5 rounded-md border border-(--border-strong) bg-(--surface-panel) px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--text-secondary) transition-colors hover:bg-(--surface-hover) disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
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

function ResultStat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border border-(--border-hairline) bg-(--surface-inset) px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-(--text-tertiary)">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-bold text-(--text-primary)" title={title ?? value}>{value}</div>
    </div>
  );
}

function ReproducedSignal({ signal }: { signal: RegressionSignal }) {
  return (
    <li className="rounded-md border border-(--status-critical-border) bg-(--status-critical-bg) p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-(--status-critical-fg) px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-(--text-oninvert)">
          {signal.faultType}
        </span>
        {typeof signal.statusCode === 'number' && (
          <span className="font-mono text-[11px] font-semibold text-(--status-critical-fg)">HTTP {signal.statusCode}</span>
        )}
      </div>
      <div className="mt-1 break-words text-[13px] text-(--text-primary)">{signal.message}</div>
      {signal.url && (
        <div className="mt-1 truncate font-mono text-[11px] text-(--text-secondary)" title={signal.url}>{signal.url}</div>
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
      <div className={`flex items-center gap-3 rounded-t-lg px-4 py-4 text-(--text-oninvert) sm:px-5 ${meta.modalBar}`}>
        {meta.icon('h-6 w-6 shrink-0')}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-90">Verification Result</div>
          <h2 id={titleId} className="text-lg font-bold leading-tight">{meta.label}</h2>
        </div>
      </div>

      <div className="bg-(--surface-panel) px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-(--text-primary)">{result.summary}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ResultStat label="Bug Class" value={result.bugClass || 'UNKNOWN'} />
          <ResultStat
            label="Steps Run"
            value={`${result.stepStats.executed}/${result.stepStats.total}`}
            title={`${result.stepStats.executed} executed, ${result.stepStats.skipped} skipped, ${result.stepStats.failed} failed`}
          />
          <ResultStat label="Timeline" value={result.timelineSource === 'session' ? 'Legacy' : 'Finding'} />
          <ResultStat label="Duration" value={formatDuration(result.durationMs)} />
        </div>

        {result.matchedSignals.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-(--text-secondary)">
              {result.verdict === 'STILL_ACTIVE' ? 'Reproduced Signals' : 'Uncorroborated Same-Class Signals'} ({result.matchedSignals.length})
            </div>
            <ul className="space-y-2">
              {result.matchedSignals.map((signal, idx) => (
                <ReproducedSignal key={idx} signal={signal} />
              ))}
            </ul>
          </div>
        )}

        {result.verdict === 'RESOLVED' && (
          <div className="mt-4 rounded-md border border-(--status-stable-border) bg-(--status-stable-bg) p-3 text-[13px] text-(--status-stable-fg)">
            {REASON_TEXT.CLEAN_REPLAY}
          </div>
        )}

        {result.verdict === 'INCONCLUSIVE' && (
          <div className="mt-4 rounded-md border border-(--status-warning-border) bg-(--status-warning-bg) p-3 text-[13px] text-(--status-warning-fg)">
            {REASON_TEXT[result.reason] ?? result.error ?? 'The replay could not conclude. Try again.'}
          </div>
        )}

        {result.verdict === 'VERIFICATION_FAILED' && (
          <div className="mt-4 rounded-md border border-(--status-warning-border) bg-(--status-warning-bg) p-3 text-[13px] text-(--status-warning-fg)">
            {result.error ? `${REASON_TEXT.REPLAY_ERROR} (${result.error})` : REASON_TEXT.REPLAY_ERROR}
          </div>
        )}

        {result.otherSignals.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-(--text-secondary)">
              Other Faults Observed — Different Class ({result.otherSignals.length})
            </div>
            <ul className="space-y-2">
              {result.otherSignals.map((signal, idx) => (
                <ReproducedSignal key={idx} signal={signal} />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-(--border-hairline) bg-(--surface-panel) px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onReverify}
          className="inline-flex items-center gap-1.5 rounded-md border border-(--border-strong) bg-(--surface-panel) px-3 py-1.5 text-[13px] font-semibold text-(--text-secondary) transition-colors hover:bg-(--surface-hover)"
        >
          
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Re-verify
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-(--surface-invert) px-3 py-1.5 text-[13px] font-semibold text-(--text-oninvert) transition-colors hover:bg-(--surface-invert-hover)"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Standardized finding metadata — a fixed, consistently-ordered row of
// labeled pills rendered identically for every bug type (methodology, CWE,
// verification status, fault step). Absent values are skipped but never
// reorder, so cards stay visually aligned regardless of which fields exist.
// ─────────────────────────────────────────────────────────────

function MetaPill({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-(--border-hairline) bg-(--surface-inset) px-2 py-1"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-(--text-tertiary)">{label}</span>
      <span className="text-[11px] font-semibold text-(--text-primary)">{value}</span>
    </span>
  );
}

function FindingMetaBar({ bug }: { bug: ForensicCaughtBug }) {
  const attribution = bug.attribution;
  const methodology = attribution?.scenario || attribution?.testingType;
  const verification = attribution?.verificationStatus
    ? `${attribution.verificationStatus.replace(/_/g, ' ')}${typeof attribution.confidenceScore === 'number' ? ` ${Math.round(attribution.confidenceScore * 100)}%` : ''}`
    : undefined;

  const pills: Array<{ label: string; value: string; title?: string }> = [];
  if (methodology) pills.push({ label: 'Methodology', value: methodology, title: 'Scenario that provoked the fault' });
  if (attribution?.cwe) pills.push({ label: 'CWE', value: attribution.cwe, title: 'MITRE CWE identifier' });
  if (verification) pills.push({ label: 'Status', value: verification, title: 'Finding-verification pipeline verdict' });
  if (typeof attribution?.stepIndex === 'number') pills.push({ label: 'Step', value: String(attribution.stepIndex), title: 'Execution step at fault time' });

  if (pills.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pills.map((pill) => <MetaPill key={pill.label} {...pill} />)}
    </div>
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
  const [showResult, setShowResult] = useState(false);
  const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
  const summaryText = useMemo(() => buildBugSummaryText(bug, index), [bug, index]);
  // Normalized view — the shared <FindingEvidence> renders the reproduction /
  // resolved-frames / suggested-fix / stack sections identically to
  // the live Errors tab.
  const view = useMemo(() => caughtBugToFindingView(bug, occurrences), [bug, occurrences]);

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
    <div className={`overflow-hidden rounded-lg border ${theme.cardBorder} bg-(--surface-panel) shadow-sm`}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 border-b ${theme.cardHeaderBg} px-4 py-3`}>
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${theme.numberBg} text-(--text-oninvert)`}>
            <Bug className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`truncate text-sm font-bold ${theme.cardTitle}`}>{bugClass}</span>
              <SeverityBadge severity={bug.severity} />
              {occurrences > 1 && (
                <span
                  title={`This fault occurred ${occurrences} times this session`}
                  className="inline-flex shrink-0 items-center rounded-full bg-(--surface-invert) px-1.5 py-0.5 font-mono text-[11px] font-bold leading-none text-(--text-oninvert)"
                >
                  ×{occurrences}
                </span>
              )}
              {verdictMeta && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${verdictMeta.chip}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${verdictMeta.dot}`} />
                  {verdictMeta.label}
                </span>
              )}
            </div>
            <div className={`text-[11px] opacity-75 ${theme.cardSub}`}>{formatReportDateTime(bug.timestamp)}</div>
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

      {/* Standardized metadata — identical row across every bug type */}
      <div className="px-4 pt-3">
        <FindingMetaBar bug={bug} />
      </div>

      {/* Message / Selector / Payload grid */}
      <div className="grid grid-cols-1 gap-3 px-4 pt-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="text-caption font-semibold uppercase tracking-wide text-(--text-secondary)">Message</div>
          <div className="mt-0.5 text-sm text-(--text-primary)">{bug.message || 'No details provided'}</div>
        </div>
        <div className="min-w-0">
          <div className="text-caption font-semibold uppercase tracking-wide text-(--text-secondary)">Selector</div>
          <div className="mt-0.5 truncate font-mono text-[13px] text-(--text-secondary)" title={bug.selector}>{bug.selector || 'N/A'}</div>
        </div>
        {bug.payloadUsed && (
          <div className="min-w-0">
            <div className="text-caption font-semibold uppercase tracking-wide text-(--text-secondary)">Payload Used</div>
            <div className="mt-0.5 truncate font-mono text-[13px] text-(--text-secondary)" title={bug.payloadUsed}>{bug.payloadUsed}</div>
          </div>
        )}
      </div>

      {/* Shared evidence: reproduction, resolved source frames, suggested
          fix, and stack trace — rendered identically to the live Errors tab. */}
      <div className="pb-2">
        <FindingEvidence view={view} />
      </div>

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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-(--status-stable-border) bg-(--status-stable-bg) px-6 py-10 text-center">
      <CircleCheckBig className="h-8 w-8 text-(--status-stable-fg)" strokeWidth={1.75} aria-hidden="true" />
      <div className="text-sm font-semibold text-(--status-stable-fg)">No findings were recorded for this session</div>
      <div className="text-[13px] text-(--status-stable-fg)">The autonomous run completed without confirming any bugs or vulnerabilities.</div>
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
    <span className="ml-1.5 rounded-full bg-(--surface-inset) px-1.5 py-0.5 font-mono text-[11px] leading-none text-(--text-secondary)">
      {count > 999 ? '999+' : count}
    </span>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${
        active
          ? 'border-(--border-strong) text-(--text-primary)'
          : 'border-transparent text-(--text-secondary) hover:text-(--text-primary)'
      }`}
    >
      {label}
      <TabCount count={count} />
    </button>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-(--border-hairline) bg-(--surface-inset) px-4 py-8 text-center text-[13px] italic text-(--text-tertiary)">
      {message}
    </div>
  );
}

// Full network log — every request (incl. successful), mirroring the live Network tab.
function statusTint(row: ForensicNetworkLog): { border: string; bg: string; status: string } {
  const code = row.statusCode ?? 0;
  if (!row.ok || code >= 500) return { border: 'border-(--status-critical-border)', bg: 'bg-(--status-critical-bg)', status: 'text-(--status-critical-fg)' };
  if (code >= 400) return { border: 'border-(--status-warning-border)', bg: 'bg-(--status-warning-bg)', status: 'text-(--status-warning-fg)' };
  return { border: 'border-(--border-hairline)', bg: 'bg-(--surface-panel)', status: 'text-(--status-stable-fg)' };
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
              <span className="rounded bg-(--surface-invert) px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-(--text-oninvert)">{row.method}</span>
              <span className={`font-mono text-[11px] font-bold ${tint.status}`}>{row.ok || row.statusCode ? `HTTP ${row.statusCode ?? '—'}` : 'FAILED'}</span>
              {row.resourceType && (
                <span className="font-mono text-[11px] uppercase tracking-wide text-(--text-tertiary)">{row.resourceType}</span>
              )}
              {row.repeatCount && row.repeatCount > 1 && (
                <span className="font-mono text-[11px] text-(--text-secondary)">×{row.repeatCount}</span>
              )}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-(--text-secondary)" title={row.url}>{row.url}</div>
            {row.message && !row.ok && <div className="mt-1 break-words text-[13px] text-(--text-primary)">{row.message}</div>}
          </li>
        );
      })}
    </ul>
  );
}

const CONSOLE_LEVEL_STYLES: Record<string, string> = {
  error: 'bg-(--status-critical-bg) text-(--status-critical-fg)',
  warning: 'bg-(--status-warning-bg) text-(--status-warning-fg)',
  info: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  debug: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)',
  trace: 'bg-(--surface-inset) text-(--text-secondary)',
  notice: 'bg-(--surface-inset) text-(--text-secondary)',
  log: 'bg-(--surface-inset) text-(--text-secondary)',
};

// Full console log — every level, mirroring the live Console tab.
function ConsoleLogList({ rows }: { rows: ForensicConsoleLog[] }) {
  if (!rows.length) return <EmptyTab message="No console output was recorded for this session." />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li key={i} className="rounded-md border border-(--border-hairline) bg-(--surface-panel) p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase ${CONSOLE_LEVEL_STYLES[row.level] ?? CONSOLE_LEVEL_STYLES.log}`}>{row.level}</span>
            {row.url && <span className="truncate font-mono text-[11px] text-(--text-tertiary)" title={row.url}>{row.url}</span>}
          </div>
          {row.message && <div className="mt-1 break-words font-mono text-[11px] text-(--text-primary)">{row.message}</div>}
          {row.stackTrace && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-(--surface-inset) p-2 font-mono text-[11px] leading-relaxed text-(--text-primary)">{row.stackTrace}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}

function ActionTimelineAppendix({ steps }: { steps: ForensicActionStep[] }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!steps.length) return null;

  const timelineText = actionStepsToMarkdown(steps);

  return (
    <section className="rounded-lg border border-(--border-hairline) bg-(--surface-panel)">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-(--surface-hover)"
      >
        <span className="text-[13px] font-semibold uppercase tracking-wider text-(--text-secondary)">
          Full Action Timeline ({steps.length} steps) — reference
        </span>
        <span className="text-[13px] text-(--text-tertiary)">{isOpen ? '▼ Collapse' : ' Expand'}</span>
      </button>
      {isOpen && (
        <div className="border-t border-(--border-hairline) px-4 py-4">
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
        const data = await useHistoryStore.getState().loadReport(sessionId);
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
      <div className="flex h-full w-full items-center justify-center bg-(--surface-panel)">
        <div className="text-center">
          <div className="text-sm font-semibold text-(--text-secondary)">Loading forensic report…</div>
          <div className="mt-2 text-[13px] text-(--text-tertiary)">Fetching the latest session details from the backend.</div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-(--surface-panel) px-6">
        <div className="max-w-md text-center">
          <div className="text-sm font-semibold text-(--status-critical-fg)">Failed to load report</div>
          <div className="mt-2 text-[13px] text-(--text-tertiary)">{error || 'No report data was returned for this session.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-(--surface-app)">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-(--border-hairline) bg-(--surface-panel) px-4 py-3 sm:px-6 sm:py-4">
        {/* Breadcrumb duplicates the compact top bar — desktop only; Back always stays. */}
        <div className="hidden min-w-0 items-center lg:flex">
          <span className="text-sm font-bold tracking-wide text-(--text-primary)">BUGSAFARI</span>
          <span className="mx-3 text-(--text-tertiary)">/</span>
          <span className="text-sm font-semibold text-(--text-secondary)">FORENSIC REPORT</span>
        </div>
        <button
          onClick={() => window.history.back()}
          className="flex shrink-0 items-center gap-2 rounded px-3 py-1.5 text-[13px] font-medium text-(--text-secondary) transition-colors hover:bg-(--surface-hover) lg:ml-auto"
        >
         <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
         Back to History
        </button>
      </header>

      {/* Report Body */}
      <main className="custom-scrollbar flex-1 overflow-auto p-3 pb-safe sm:p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
          <ExecutiveSummary report={report} sessionId={sessionId || 'N/A'} findingsCount={runtimeBugs.length} />

          <AiInsightsPanel aiAnalysis={report.aiAnalysis} />

          {/* Tabbed panels — same categorized layout as the live execution. */}
          <section>
            <div className="scroll-rail mb-4 flex items-center gap-1 border-b border-(--border-hairline)">
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

      
    </div>
  );
}

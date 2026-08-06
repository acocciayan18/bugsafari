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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, TriangleAlert, CircleHelp, CircleX, RefreshCcw, Globe, Lightbulb, LoaderCircle, RefreshCw, ArrowLeft, CircleCheckBig, Info, Calendar, Hash, Sparkles } from 'lucide-react';
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
import { actionStepsToMarkdown } from '../../utils/reproductionFormat';
import { CopyButton, fallbackReasonText } from '../common/ForensicCardKit';
import { Skeleton } from '../ui/Skeleton';
import { formatReportDateTime } from '../../utils/datetime';
import { TerminationBadge, outcomeFromStatus } from '../common/TerminationBadge';
import { isCleanTermination, INFILTRATION_PROFILE_CATALOG, type InfiltrationProfileId } from '../../types';
import { isActionableNetworkStatus, type RemediationFailureReason } from '../../../../shared/types.js';
import { ActionStepList } from '../common/FindingEvidence';
import FindingCard, { BASE_FINDING_THEME } from '../common/FindingCard';
import NetworkFailureList, { type NetworkFailureRow } from '../common/NetworkFailureCard';
import ConsoleMessageList from '../common/ConsoleMessageCard';
import { caughtBugToFindingView, humanizeFindingTitle } from '../../utils/findingView';
import { requestAiInsights } from '../../services/historyService';
import { Modal } from '../ui/Modal';
import {
  useRegressionVerifier,
  IDLE_VERIFY_STATUS,
  type VerifyStatus,
} from '../../application/useCases/useRegressionVerifier';

// Operator-facing profile label, or '' when the report predates profile recording.
function reportProfileLabel(id?: InfiltrationProfileId): string {
  return INFILTRATION_PROFILE_CATALOG.find((option) => option.id === id)?.label ?? '';
}

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
    return outcome === 'graceful-shutdown' || outcome === 'abandoned' || outcome === 'engine-error'
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
      <div className="text-caption font-medium   text-(--text-secondary)">{label}</div>
      <div className={`mt-0.5 text-[13px] font-bold tabular-nums ${valueClassName}`}>{value}</div>
    </div>
  );
}

function ExecutiveSummary({ report, sessionId, findingsCount }: { report: ForensicReportResponse; sessionId: string; findingsCount?: number }) {
  const theme = statusTheme(report.status);
  const [showRoutes, setShowRoutes] = useState(false);
  // Prefer the human-readable RUN- code from the report body; fall back to the routed id.
  const runCode = report.runId || sessionId;
  // Prefer the DISTINCT finding count (identical repeats collapsed) so the summary
  // matches the number of cards below; fall back to raw totals for legacy data.
  const findingsTotal = findingsCount && findingsCount > 0
    ? findingsCount
    : (report.findings?.totalBugsFound ?? report.metrics?.totalBugsFound ?? 0);

  const routes = report.visitedRoutes ?? [];

  return (
    <section className={`rounded-xl border ${theme.border} ${theme.bg} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
  <Globe
    className="w-3.5 h-3.5 shrink-0 text-(--text-tertiary)"
    aria-hidden="true"
  />
  <div
    className="truncate text-lg font-bold text-(--text-primary)"
    title={report.url}
  >
    {report.url || 'N/A'}
  </div>
</div>
<div className="flex flex-wrap items-center gap-2 text-xs text-(--text-secondary)">
          {/* Run Session Badge — public RUN- code, falls back to the record id on legacy reports */}
          <span className="inline-flex items-center gap-1.5 py-0.5 rounded text-(--text-secondary) font-mono font-medium ">
            <Hash className="w-3.5 h-3.5 text-(--text-tertiary) shrink-0" aria-hidden="true" />
            <span>{runCode}</span>
            <CopyButton text={runCode} label="Run ID" />
          </span>

    {/* Vertical Hairline Divider */}
    <span className="h-3.5 w-px bg-(--border-hairline)" aria-hidden="true" />

    {/* Date Timestamp */}
    <span className="inline-flex items-center gap-1.5 text-(--text-secondary)">
      <Calendar className="w-3.5 h-3.5 text-(--text-tertiary) shrink-0" aria-hidden="true" />
      <span>{formatReportDateTime(report.date)}</span>
    </span>

    {/* Optional Termination Reason */}
    {report.endedReason && (
      <>
        {/* Vertical Hairline Divider */}
        <span className="h-3.5 w-px bg-(--border-hairline)" aria-hidden="true" />

        <span className="inline-flex items-center gap-1.5 text-(--text-tertiary)">
          <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[250px]">{report.endedReason}</span>
        </span>
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
              <span className={`text-[13px] font-bold uppercase  ${theme.text}`}>{report.status || 'UNKNOWN'}</span>
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-flow-col auto-cols-max gap-6 border-t border-(--border-hairline) pt-4 justify-start">
  {/* Which profile produced these findings — absent on reports predating the field. */}
  {reportProfileLabel(report.infiltrationProfile) && (
    <StatBlock label="Profile" value={reportProfileLabel(report.infiltrationProfile)} />
  )}
  <StatBlock label="Duration" value={formatDuration(report.duration)} />
  <StatBlock
    label="Findings"
    value={findingsTotal}
    valueClassName={
      findingsTotal > 0
        ? "text-(--status-critical-fg)"
        : "text-(--status-stable-fg)"
    }
  />
  <StatBlock
    label="Risk Score"
    value={report.riskScore ?? 0}
    valueClassName={riskTheme(report.riskScore ?? 0)}
  />
</div>

      {routes.length > 0 && (
        <div className="mt-4 border-t border-(--border-hairline) pt-3">
          <button
            type="button"
            onClick={() => setShowRoutes((prev) => !prev)}
            className="flex items-center gap-1.5 text-caption font-semibold uppercase r text-(--text-secondary) transition-colors hover:text-(--text-primary)"
          >
            <span>{showRoutes ? '▼' : ''}</span>
            <span>Visited Routes ({routes.length})</span>
          </button>
          {showRoutes && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-(--text-secondary)">
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

function AiInsightsPanel({
  aiAnalysis,
  sessionId,
  findings,
}: {
  aiAnalysis: ForensicReportResponse['aiAnalysis'];
  sessionId?: string;
  findings: ForensicCaughtBug[];
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reason, setReason] = useState<RemediationFailureReason | undefined>();
  const [override, setOverride] = useState<{ rootCause: string; recommendations: string[] } | null>(null);

  const rootCause = override?.rootCause ?? aiAnalysis?.rootCause;
  const recommendations = override?.recommendations ?? aiAnalysis?.recommendations ?? [];
  const aiGenerated = Boolean(override) || Boolean(aiAnalysis?.aiGenerated);
  const canGenerate = Boolean(sessionId) && findings.length > 0;

  // Navigating off the report mid-request must not setState on an unmounted tree.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const generate = async () => {
    if (!sessionId) return;
    setStatus('loading');
    try {
      const result = await requestAiInsights({
        sessionId,
        riskLevel: aiAnalysis?.riskLevel,
        fallbackRootCause: aiAnalysis?.rootCause,
        fallbackRecommendations: aiAnalysis?.recommendations,
        findings: findings.map((b) => ({
          bugClass: b.attribution?.bugClass ?? b.type,
          severity: b.severity,
          message: b.message,
          elementLabel: b.elementLabel,
        })),
      });
      if (!mountedRef.current) return;
      if (result.source === 'ai') setOverride({ rootCause: result.rootCause, recommendations: result.recommendations });
      setReason(result.reason);
      setStatus(result.source === 'ai' ? 'idle' : 'error');
    } catch {
      if (!mountedRef.current) return;
      setReason('network');
      setStatus('error');
    }
  };

  if (!aiAnalysis || (!rootCause && !recommendations.length && !canGenerate)) return null;

  return (
    <section className="rounded-lg border border-(--status-neutral-border) bg-(--status-neutral-bg) p-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold uppercase r text-(--status-neutral-fg)">
        <Lightbulb className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span>Insights</span>
        {aiAnalysis.riskLevel && (
          <span className="rounded-full bg-(--surface-raised) px-2 py-0.5 text-xs font-semibold uppercase text-(--status-neutral-fg)">
            {aiAnalysis.riskLevel} risk
          </span>
        )}
        {aiGenerated && (
          <span className="rounded-full bg-(--surface-raised) px-2 py-0.5 text-xs font-semibold normal-case text-(--status-neutral-fg)">✦ AI-generated</span>
        )}
        {/* Generate once per run: hidden once AI insights exist (fresh or persisted),
            so a successful result is shown directly and never regenerated. It returns
            only when generation failed or fell back to the deterministic analysis. */}
        {canGenerate && !aiGenerated && (
          <button
            type="button"
            onClick={generate}
            disabled={status === 'loading'}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-(--border-hairline) bg-(--surface-raised) px-2 py-1 text-xs font-semibold normal-case text-(--text-secondary) hover:text-(--text-primary) disabled:opacity-60"
          >
            {status === 'loading'
              ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Generating…</>
              : <><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {status === 'error' ? 'Retry with AI' : 'Generate with AI'}</>}
          </button>
        )}
      </div>
      {status === 'error' && (
        <p className="mt-2 text-xs font-medium text-(--status-critical-fg)">{fallbackReasonText(reason)} Showing the built-in analysis instead.</p>
      )}
      {rootCause && (
        <p className="mt-3 text-[13px] leading-relaxed text-(--text-primary)">{rootCause}</p>
      )}
      {recommendations.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {recommendations.map((recommendation, idx) => (
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
  REPRODUCED: 'The original fault came back during replay, so the defect is still present.',
  CLEAN_REPLAY: 'The recorded steps replayed cleanly, and none of the original fault signals came back.',
  INSUFFICIENT_REPLAY:
    'Too few of the recorded steps actually ran (selectors may have changed), so a clean run does not prove the fix.',
  FAULT_TRIGGER_NOT_EXERCISED:
    'The replay never re-triggered the request that caused the original fault, so a clean run cannot prove it is fixed.',
  UNVERIFIABLE_BUG_CLASS:
    "We can't confirm this kind of bug with replay alone. Re-test it with a live exploration run.",
  WEAK_MATCH_ONLY:
    "A fault of the same type recurred but couldn't be confirmed as the original defect — this leans toward still-active. Treat it as unconfirmed, not fixed.",
  NO_REPLAY_STEPS:
    "This finding has no recorded reproduction steps, so there was nothing to replay — Verify Fix can't confirm it. Re-run a live exploration to capture a replayable timeline.",
  LEGACY_TIMELINE:
    'This finding predates per-finding timelines, so the session-wide replay may never reach the faulting state and a clean run is not proof.',
  TARGET_UNREACHABLE:
    "We couldn't reach the target to replay it — this says nothing about the bug. Check the app is running and retry.",
  AUTH_WALL:
    "The replay hit a login wall (the saved session's credentials have expired), so it never reached the recorded surface. Re-test with a fresh authenticated run.",
  REPLAY_ERROR: "We couldn't replay the target, so this result says nothing about the bug. Try again.",
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
        className="inline-flex items-center gap-2 rounded-md bg-(--surface-inset) px-3 py-1.5 text-xs font-semibold uppercase  text-(--text-secondary)"
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
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold uppercase  transition-colors ${meta.badge}`}
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
      className="inline-flex items-center gap-1.5 rounded-md border border-(--border-strong) bg-(--surface-panel) px-3 py-1.5 text-xs font-semibold uppercase  text-(--text-secondary) transition-colors hover:bg-(--surface-hover) disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="text-[9px] font-semibold uppercase r text-(--text-tertiary)">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-bold text-(--text-primary)" title={title ?? value}>{value}</div>
    </div>
  );
}

function ReproducedSignal({ signal }: { signal: RegressionSignal }) {
  return (
    <li className="rounded-md border border-(--status-critical-border) bg-(--status-critical-bg) p-3">
      <div className="flex items-center gap-2">
        <span className="rounded bg-(--status-critical-fg) px-1.5 py-0.5 text-[9px] font-bold uppercase  text-(--text-oninvert)">
          {signal.faultType}
        </span>
        {typeof signal.statusCode === 'number' && (
          <span className="font-mono text-xs font-semibold text-(--status-critical-fg)">HTTP {signal.statusCode}</span>
        )}
      </div>
      <div className="mt-1 break-words text-[13px] text-(--text-primary)">{signal.message}</div>
      {signal.url && (
        <div className="mt-1 truncate font-mono text-xs text-(--text-secondary)" title={signal.url}>{signal.url}</div>
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
          <div className="text-xs font-semibold uppercase r opacity-90">Verification Result</div>
          <h2 id={titleId} className="text-lg font-bold leading-tight">{meta.label}</h2>
        </div>
      </div>

      <div className="bg-(--surface-panel) px-4 py-4 sm:px-5">
        <p className="text-[13px] leading-relaxed text-(--text-primary)">{result.summary}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ResultStat label="Bug Class" value={humanizeFindingTitle(result.bugClass) || 'Unknown'} />
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
            <div className="mb-2 text-xs font-bold uppercase r text-(--text-secondary)">
              {result.verdict === 'STILL_ACTIVE' ? 'Reproduced Signals' : 'Unconfirmed Same-Type Signals'} ({result.matchedSignals.length})
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
            {REASON_TEXT[result.reason] ?? 'The replay could not finish. Try again.'}
          </div>
        )}

        {result.verdict === 'VERIFICATION_FAILED' && (
          <div className="mt-4 rounded-md border border-(--status-warning-border) bg-(--status-warning-bg) p-3 text-[13px] text-(--status-warning-fg)">
            {REASON_TEXT[result.reason] ?? REASON_TEXT.REPLAY_ERROR}
          </div>
        )}

        {result.otherSignals.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-bold uppercase r text-(--text-secondary)">
              Other Faults Observed (Different Type) ({result.otherSignals.length})
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

// Saved-report wrapper around the shared <FindingCard>: adds the Verify Fix
// lifecycle (verdict theme, status chip, control, result modal). Everything else
// is the shared card, so the saved view cannot drift from the live Errors tab.
function ReportFindingCard({
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
  // Normalized view — the shared <FindingCard> renders identity, metadata and
  // evidence exactly as the live Errors tab does.
  const view = useMemo(() => caughtBugToFindingView(bug, occurrences), [bug, occurrences]);

  // A verifiable finding needs both a persisted session id and a stable bugId.
  const canVerify = Boolean(sessionId) && Boolean(bug.bugId);
  const disabledReason = !sessionId
    ? "This report can't be replayed right now."
    : !bug.bugId
      ? "This finding can't be replayed."
      : undefined;

  // Settled verdict drives both the card theme and the header status chip.
  const settled = status.state === 'done' ? status.result : null;
  const verdictMeta = settled ? verdictMetaOf(settled.verdict) : null;

  const triggerVerify = (): void => {
    if (canVerify && sessionId) onVerify({ sessionId, bugId: bug.bugId });
  };

  // Surface the outcome immediately: pop the result modal whenever a fresh
  // terminal result arrives (initial verify or any re-verify → a new object).
  useEffect(() => {
    if (settled) setShowResult(true);
  }, [settled]);

  return (
    <>
      <FindingCard
        view={view}
        index={index}
        aiFix
        sessionId={sessionId}
        theme={verdictMeta ?? BASE_FINDING_THEME}
        statusChip={verdictMeta && (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase  ${verdictMeta.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${verdictMeta.dot}`} />
            {verdictMeta.label}
          </span>
        )}
        actions={
          <VerifyFixControl
            status={status}
            disabled={!canVerify || status.state === 'running'}
            disabledReason={disabledReason}
            onVerify={triggerVerify}
            onOpenResult={() => setShowResult(true)}
          />
        }
      />

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
    </>
  );
}

function CleanRunCard() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-(--status-stable-border) bg-(--status-stable-bg) px-6 py-10 text-center">
      <CircleCheckBig className="h-8 w-8 text-(--status-stable-fg)" strokeWidth={1.75} aria-hidden="true" />
      <div className="text-[13px] font-semibold text-(--status-stable-fg)">No findings were recorded for this session</div>
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
    <span className="ml-1.5 rounded-full bg-(--surface-inset) px-1.5 py-0.5 font-mono text-xs leading-none text-(--text-secondary)">
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

// Adapt a persisted network row into the shared card's normalized shape, so the
// saved Network tab renders through the SAME <NetworkFailureList> as the live tab.
function networkLogToRow(row: ForensicNetworkLog): NetworkFailureRow {
  return {
    method: row.method,
    statusCode: row.statusCode,
    url: row.url,
    ok: row.ok,
    count: row.repeatCount ?? 1,
    resourceType: row.resourceType,
    errorText: !row.ok ? row.message : undefined,
  };
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
        <span className="text-[13px] font-semibold uppercase r text-(--text-secondary)">
          Full Action Timeline ({steps.length} steps), for reference
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

// ─────────────────────────────────────────────────────────────
// Loading state — mirrors the report's own chrome (header, summary
// block, tab strip, finding cards) so the page does not reflow when
// the real document lands.
// ─────────────────────────────────────────────────────────────

function ForensicReportSkeleton() {
  return (
    <div role="status" aria-label="Loading forensic report" className="flex h-full w-full flex-col bg-(--surface-app)">
      <header className="flex items-center justify-between gap-2 border-b border-(--border-hairline) bg-(--surface-panel) px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="hidden h-4 w-56 lg:block" />
      </header>

      <div className="custom-scrollbar flex-1 overflow-hidden p-3 sm:p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
          <div className="rounded-xl border border-(--border-hairline) bg-(--surface-panel) p-5">
            <Skeleton className="h-5 w-2/3 max-w-sm" />
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell} className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-1 border-b border-(--border-hairline) pb-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-24" />
          </div>

          {[0, 1, 2].map((card) => (
            <div key={card} className="space-y-3 rounded-xl border border-(--border-hairline) bg-(--surface-panel) p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-4 w-1/2 max-w-xs" />
              </div>
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ForensicReport() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [report, setReport] = useState<ForensicReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('This report link is missing its ID.');
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
          console.error('[ForensicReport] Failed to load report:', err);
          setError("We couldn't load this report. Try again in a moment.");
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
    // Only failures render — filter guards legacy sessions saved with 2xx/3xx rows.
    if (Array.isArray(report?.networkLog)) return report!.networkLog.filter((n) => isActionableNetworkStatus(n.statusCode));
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

  if (isLoading) return <ForensicReportSkeleton />;


  if (error || !report) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-(--surface-panel) px-6">
        <div className="max-w-md text-center">
          <div className="text-[13px] font-semibold text-(--status-critical-fg)">Couldn't load this report</div>
          <div className="mt-2 text-[13px] text-(--text-tertiary)">{error || "We couldn't find any data for this report."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-(--surface-app)">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-(--border-hairline) bg-(--surface-panel) px-4 py-3 sm:px-6 sm:py-4">
        {/* Back leads the header (left) for intuitive back-navigation flow. */}
        <button
          onClick={() => window.history.back()}
          className="flex shrink-0 items-center cursor-pointer  gap-2 rounded px-3 py-1.5 text-sm font-medium text-(--text-secondary) transition-colors hover:bg-(--surface-hover)"
        >
         <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
         Back
        </button>
        {/* Breadcrumb duplicates the compact top bar — desktop only, pushed right. */}
        <div className="hidden min-w-0 items-center lg:ml-auto lg:flex">
          <span className="text-sm font-bold  text-(--text-primary)">BUGSAFARI</span>
          <span className="mx-3 text-(--text-tertiary)">/</span>
          <span className="text-sm font-semibold text-(--text-secondary)">FORENSIC REPORT</span>
        </div>
      </header>

      {/* Report Body */}
      <main className="custom-scrollbar flex-1 overflow-auto p-3  sm:p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
          <ExecutiveSummary report={report} sessionId={sessionId || 'N/A'} findingsCount={runtimeBugs.length} />

          <AiInsightsPanel aiAnalysis={report.aiAnalysis} sessionId={sessionId} findings={runtimeBugs} />

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
                    <ReportFindingCard
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
            {activeTab === 'network' && (
              <NetworkFailureList
                rows={networkRows.map(networkLogToRow)}
                emptyMessage="No network failures were recorded for this session."
              />
            )}
            {activeTab === 'console' && (
              consoleRows.length > 0
                ? <ConsoleMessageList logs={consoleRows} />
                : <EmptyTab message="No console output was recorded for this session." />
            )}
          </section>

          <ActionTimelineAppendix steps={report.actionSteps ?? []} />
        </div>
      </main>

      
    </div>
  );
}

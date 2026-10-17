// ═══════════════════════════════════════════════════════════════
// FindingCard - the ONE card that renders a single finding, used by
// the live Errors tab (unsaved incidents/crash reports) and the saved
// Forensic Report (persisted caughtBugs). Both drive it with a
// normalized FindingView, so identity, severity, metadata, message,
// selector/payload and evidence are byte-identical before and after a
// save. Callers only inject what is genuinely surface-specific: the
// verdict theme + status chip and header actions (Verify Fix) on the
// report, the AI diagnostic block on the live tab.
// ═══════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import { Bug } from 'lucide-react';
import type { FindingAttribution } from '../../types';
import { buildFindingSummary, displayableSelector, humanizeFindingTitle, type FindingView } from '../../utils/findingView';
import { CopyButton, SeverityBadge } from './ForensicCardKit';
import CweBadge from './CweBadge';
import FindingEvidence from './FindingEvidence';

export interface FindingCardTheme {
  cardBorder: string;
  cardHeaderBg: string;
  cardTitle: string;
  cardSub: string;
  numberBg: string;
}

// Unverified finding theme — the confirmed-bug look, mapped to critical tokens.
export const BASE_FINDING_THEME: FindingCardTheme = {
  cardBorder: 'border-(--status-critical-border)',
  cardHeaderBg: 'bg-(--status-critical-bg) border-(--status-critical-border)',
  cardTitle: 'text-(--status-critical-fg)',
  cardSub: 'text-(--status-critical-fg)',
  numberBg: 'bg-(--status-critical-fg)',
};

function MetaPill({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-(--border-hairline) bg-(--surface-inset) px-2 py-1"
    >
      <span className="text-xs font-semibold uppercase text-(--text-tertiary)">{label}</span>
      <span className="text-xs font-semibold text-(--text-primary)">{value}</span>
    </span>
  );
}

// Plain-language labels for the three detection-time verification states, so the chip
// reads as a stage ("Needs verification") not a raw enum ("NEEDS_VERIFICATION").
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  NEEDS_VERIFICATION: 'Needs verification',
  INCONCLUSIVE: 'Inconclusive',
};

// Why a finding sits in each state. NEEDS_VERIFICATION is the confusing case: a strong
// evidence score can still land here because no reproduction pass has re-observed it.
const STATUS_HINT: Record<string, string> = {
  CONFIRMED: 'A reproduction pass re-observed this fault in the target app during the detection run.',
  NEEDS_VERIFICATION: 'Plausibly real, but no reproduction pass has re-observed it yet. A high evidence score only means the signal was strong, not that the bug has been reproduced.',
  INCONCLUSIVE: 'Evidence was too weak, or the origin too uncertain, to report this as a confirmed bug.',
};

// Appends the replay posture to the needs-verification hint when the engine recorded one,
// so the reader learns WHY it is unconfirmed, not just that it is.
function statusHint(status: string, state?: string): string {
  const base = STATUS_HINT[status] ?? '';
  if (status !== 'NEEDS_VERIFICATION') return base;
  if (state === 'PENDING') return `${base} A reproduction replay has not settled yet.`;
  if (state === 'NOT_REPRODUCED') return `${base} A replay ran but did not reproduce the fault.`;
  return base;
}

// Fixed, consistently-ordered metadata row rendered identically for every finding.
// Absent values are skipped but never reorder, so cards stay visually aligned.
// Verification STATUS (what stage the finding is at) and the EVIDENCE score (how strong
// the signal was) ride in ONE pill, "Needs verification · 99% evidence", so a strong score
// never reads as a bug already confirmed. The word "evidence" after the number names what
// the % measures. Both reflect the detection run; a later Verify Fix result supersedes.
// Detection time / methodology / fault step are deliberately absent — the report
// header already carries the run's date and scenario, so repeating them per card
// is noise. The data stays on `attribution`, it is simply not surfaced here.
const EVIDENCE_HINT =
  'The % is how strong the signal was when BugSafari first detected this (0 to 100%): evidence strength only, not the chance the bug is real nor whether a reproduction pass confirmed it. A Verify Fix result, when present, supersedes this.';

export function FindingMetaBar({ attribution }: { attribution?: FindingAttribution }) {
  const status = attribution?.verificationStatus;
  const statusLabel = status ? STATUS_LABEL[status] ?? status.replace(/_/g, ' ') : undefined;
  const evidence = typeof attribution?.confidenceScore === 'number'
    ? `${Math.round(attribution.confidenceScore * 100)}% evidence`
    : undefined;

  // Join whichever parts exist with a middot; drop the separator when only one is present.
  const verdict = [statusLabel, evidence].filter(Boolean).join(' · ') || undefined;
  const title = [statusLabel && statusHint(status ?? '', attribution?.reproductionState), evidence && EVIDENCE_HINT]
    .filter(Boolean)
    .join(' ');

  if (!attribution?.cwe && !verdict) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attribution?.cwe && <CweBadge cwe={attribution.cwe} />}
      {verdict && <MetaPill label="At detection" value={verdict} title={title} />}
    </div>
  );
}

export default function FindingCard({
  view,
  index,
  theme = BASE_FINDING_THEME,
  actions,
  aiFix = false,
  sessionId,
  children,
}: {
  view: FindingView;
  index: number;
  theme?: FindingCardTheme;
  actions?: ReactNode;
  aiFix?: boolean;
  sessionId?: string;
  children?: ReactNode;
}) {
  // Human-readable culprit name (primary) plus a STABLE CSS selector beneath it (id,
  // data-testid/cy, readable class, or accessible attribute). A fragile structural path
  // (body > … > nth-of-type) is deliberately omitted — better no selector than a brittle one.
  const element = view.elementLabel;
  const selector = displayableSelector(view.selector, element);

  return (
    <div className={`overflow-hidden rounded-(--radius-lg) border ${theme.cardBorder} bg-(--surface-panel) shadow-(--shadow-md)`}>
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b ${theme.cardHeaderBg} px-4 py-2.5`}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${theme.numberBg} text-(--text-oninvert)`}>
            <Bug className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span title={humanizeFindingTitle(view.title)} className={`truncate text-[13px] font-bold ${theme.cardTitle}`}>{humanizeFindingTitle(view.title)}</span>
            <SeverityBadge severity={view.severity} />
            {view.occurrences > 1 && (
              <span
                title={`This fault occurred ${view.occurrences} times this session`}
                className="inline-flex shrink-0 items-center rounded-full bg-(--surface-invert) px-2 py-0.5 font-mono text-xs font-bold leading-none text-(--text-oninvert)"
              >
                ×{view.occurrences}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          
          <CopyButton text={buildFindingSummary(view, index)} label="Finding" />
        </div>
      </div>

      {/* Facts block — a null meta bar collapses its own gap, so no empty band appears */}
      <div className="flex flex-col gap-3 px-4 pt-3">
        <FindingMetaBar attribution={view.attribution} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="text-caption font-semibold uppercase text-(--text-secondary)">Message</div>
            <div className="mt-0.5 break-words text-[13px] text-(--text-primary)">{view.message || 'No details provided'}</div>
          </div>
          {element && (
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase text-(--text-secondary)">Element</div>
              <div className="mt-0.5 truncate text-[13px] text-(--text-primary)" title={element}>{element}</div>
              {selector && (
                <div className="mt-0.5 truncate font-mono text-xs text-(--text-tertiary)" title={selector}>{selector}</div>
              )}
            </div>
          )}
          {!element && view.endpointLabel && (
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase text-(--text-secondary)">API Endpoint</div>
              <div className="mt-0.5 truncate font-mono text-[13px] text-(--text-primary)" title={view.endpointLabel}>{view.endpointLabel}</div>
            </div>
          )}
        </div>
      </div>

      {/* Surface-specific enrichment (live AI diagnosis) sits between the facts and the evidence */}
      {children && <div className="px-4">{children}</div>}

      <div>
        <FindingEvidence view={view} aiFix={aiFix} sessionId={sessionId} />
      </div>
    </div>
  );
}

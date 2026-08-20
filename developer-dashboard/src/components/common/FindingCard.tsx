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

// Fixed, consistently-ordered metadata row rendered identically for every finding.
// Absent values are skipped but never reorder, so cards stay visually aligned.
// Detection time / methodology / fault step are deliberately absent — the report
// header already carries the run's date and scenario, so repeating them per card
// is noise. The data stays on `attribution`, it is simply not surfaced here.
export function FindingMetaBar({ attribution }: { attribution?: FindingAttribution }) {
  const verification = attribution?.verificationStatus
    ? `${attribution.verificationStatus.replace(/_/g, ' ')}${typeof attribution.confidenceScore === 'number' ? ` ${Math.round(attribution.confidenceScore * 100)}%` : ''}`
    : undefined;

  if (!attribution?.cwe && !verification) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {attribution?.cwe && <CweBadge cwe={attribution.cwe} />}
      {verification && <MetaPill label="Status" value={verification} title="How this finding was verified" />}
    </div>
  );
}

export default function FindingCard({
  view,
  index,
  theme = BASE_FINDING_THEME,
  actions,
  showBypass = true,
  aiFix = false,
  sessionId,
  children,
}: {
  view: FindingView;
  index: number;
  theme?: FindingCardTheme;
  actions?: ReactNode;
  showBypass?: boolean;
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
    <div className={`overflow-hidden rounded-lg border ${theme.cardBorder} bg-(--surface-panel) shadow-sm`}>
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b ${theme.cardHeaderBg} px-4 py-2.5`}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${theme.numberBg} text-(--text-oninvert)`}>
            <Bug className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span title={view.headline ?? humanizeFindingTitle(view.title)} className={`truncate text-[13px] font-bold ${theme.cardTitle}`}>{view.headline ?? humanizeFindingTitle(view.title)}</span>
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
          {view.payloadUsed && (
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase text-(--text-secondary)">Payload Used</div>
              <div className="mt-0.5 truncate font-mono text-[13px] text-(--text-secondary)" title={view.payloadUsed}>{view.payloadUsed}</div>
            </div>
          )}
        </div>
      </div>

      {/* Surface-specific enrichment (live AI diagnosis) sits between the facts and the evidence */}
      {children && <div className="px-4">{children}</div>}

      <div className="pb-3">
        <FindingEvidence view={view} showBypass={showBypass} aiFix={aiFix} sessionId={sessionId} />
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IncidentReport, ForensicCrashReport } from '../../types';
import { dedupeReportsAgainstIncidents, groupBySignature, liveFaultSignature } from '../../utils/errorDeduplication';
import { incidentToFindingView, reportToFindingView, type FindingView } from '../../utils/findingView';
import AiDiagnosticCard from './AiDiagnosticCard';
import { AttributionBadges as AttributionBadgesBase, CopyButton, SeverityBadge } from '../common/ForensicCardKit';
import FindingEvidence from '../common/FindingEvidence';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface ErrorTabPanelProps {
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS (this panel's own layout wrapper around the shared kit)
// ─────────────────────────────────────────────────────────────

/** This panel places attribution badges with left/top padding to match its card layout. */
const AttributionBadges = ({ attribution }: Parameters<typeof AttributionBadgesBase>[0]) => (
  <div className="px-4 pt-3">
    <AttributionBadgesBase attribution={attribution} />
  </div>
);

/** Occurrence count for a collapsed group of identical faults (hidden when singular). */
const OccurrenceBadge = ({ count }: { count: number }) => {
  if (count <= 1) return null;
  return (
    <span
      title={`This fault occurred ${count} times this session`}
      className="rounded-full border border-(--status-critical-border) px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-(--status-critical-fg)"
    >
      ×{count}
    </span>
  );
};

/** Metadata cell for the flat key/value grid — muted label, plain value. */
const MetaCell = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold text-(--text-tertiary) uppercase tracking-wide">{label}</div>
    <div className={`text-xs ${mono ? 'font-mono' : ''} text-(--text-secondary) whitespace-normal break-words`}>{value}</div>
  </div>
);

// One card for a normalized finding view. The header/meta/message/AI enrichment are
// this panel's live chrome; the evidence block below is the shared <FindingEvidence>
// so a live fault and its saved counterpart render their evidence identically.
function LiveFindingCard({
  view,
  icon,
  kindLabel,
  source,
  count,
  index,
  aiDiagnostics,
}: {
  view: FindingView;
  icon: string;
  kindLabel: string;
  source: string;
  count: number;
  index: number;
  aiDiagnostics: any;
}) {
  return (
    <div className="bg-(--surface-panel) border border-(--border-hairline) border-l-4 border-l-(--status-critical-fg) rounded-lg overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-(--border-hairline)">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full border border-(--status-critical-border) text-(--status-critical-fg) text-xs font-bold">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-(--status-critical-fg)">{kindLabel}</span>
              <SeverityBadge severity={view.severity} />
              <OccurrenceBadge count={count} />
            </div>
            <div className="text-[11px] text-(--text-tertiary)">
              {view.timestamp?.split('T')[1]?.slice(0, 8) || view.timestamp || 'Unknown'}
            </div>
          </div>
        </div>
        <CopyButton text={view.message} label="Error Message" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-(--surface-inset) border-b border-(--border-hairline)">
        <MetaCell label="Type" value={view.title} />
        <MetaCell label="Severity" value={view.severity ?? 'error'} />
        <MetaCell label="Source" value={source} />
        <MetaCell label="Index" value={`#${index}`} />
      </div>

      <AttributionBadges attribution={view.attribution} />

      <div className="px-4 py-3 bg-(--surface-panel) border-b border-(--border-hairline) max-h-40 overflow-y-auto custom-scrollbar">
        <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-(--text-secondary)">
          {view.message}
        </div>
        <AiDiagnosticCard ai={aiDiagnostics} />
      </div>

      <div className="pb-3">
        <FindingEvidence view={view} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: ErrorTabPanel
// ─────────────────────────────────────────────────────────────

export default function ErrorTabPanel({
  errors = { incidents: [], reports: [] }
}: ErrorTabPanelProps) {
  const errorIncidents = errors?.incidents ?? [];
  // A JS exception / console error arrives as BOTH an incident and a crash
  // report; render the incident once and suppress the mirrored report so each
  // fault is a single card (matching the engine's confirmed-bug count).
  const errorReports = dedupeReportsAgainstIncidents(errorIncidents, errors?.reports ?? []);

  // Collapse identical repeats (same fault re-thrown across the run) into one card
  // with an ×N count — lossless display grouping, nothing is dropped.
  const incidentGroups = groupBySignature<IncidentReport>(errorIncidents, liveFaultSignature, (i) => i.occurrences ?? 1);
  const reportGroups = groupBySignature<ForensicCrashReport>(errorReports, liveFaultSignature, (r) => r.occurrences ?? 1);

  return (
    <div className="space-y-4 p-2">
      {incidentGroups.length === 0 && reportGroups.length === 0 ? (
        <div className="text-(--text-secondary) italic py-4">No errors captured yet.</div>
      ) : (
        <>
          {incidentGroups.map(({ item: incident, count }, idx) => (
            <LiveFindingCard
              key={`incident-${idx}`}
              view={incidentToFindingView(incident, count)}
              icon="⚠"
              kindLabel="Forensics (Incident)"
              source="Runtime"
              count={count}
              index={idx}
              aiDiagnostics={(incident as any).aiDiagnostics}
            />
          ))}

          {reportGroups.map(({ item: report, count }, idx) => (
            <LiveFindingCard
              key={`report-${idx}`}
              view={reportToFindingView(report, count)}
              icon="🔥"
              kindLabel="Console Error"
              source="Console"
              count={count}
              index={idx}
              aiDiagnostics={(report as any).aiDiagnostics}
            />
          ))}
        </>
      )}
    </div>
  );
}

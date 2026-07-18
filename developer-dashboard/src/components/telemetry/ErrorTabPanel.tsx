/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import type { IncidentReport, ForensicCrashReport } from '../../types';
import { dedupeReportsAgainstIncidents, groupBySignature, liveFaultSignature } from '../../utils/errorDeduplication';
import ReproductionChecklist from './ReproductionChecklist';
import AiDiagnosticCard from './AiDiagnosticCard';
import { AttributionBadges as AttributionBadgesBase, CopyButton, ExpandableCodeBlock, SuggestedFixBlock } from '../common/ForensicCardKit';

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
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Extract metadata from error objects for structured grid display
 */
const extractErrorMetadata = (error: IncidentReport | ForensicCrashReport): Record<string, string> => {
  const isCrashReport = 'breadcrumbs' in error && Array.isArray(error.breadcrumbs) && error.breadcrumbs.length > 0;

  return {
    type: isCrashReport ? 'CrashReport' : 'Incident',
    timestamp: error.timestamp || new Date().toISOString(),
    severity: isCrashReport ? 'critical' : 'error',
    source: isCrashReport ? 'Console' : 'Runtime',
  };
};

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
      className="rounded-full bg-[var(--status-critical-fg)] px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-[var(--text-oninvert)]"
    >
      ×{count}
    </span>
  );
};

/**
 * Bind directly to the frozen, backend-narrated reproduction playbook attached to
 * this finding. No fallback recompilation from raw steps/breadcrumbs — the steps
 * shown live are exactly the steps captured at the moment of the fault and saved
 * to history.
 */
const ReproductionSection = ({ steps }: { steps: string[] | undefined }) => {
  if (steps && steps.length > 0) {
    return <ReproductionChecklist steps={steps} />;
  }
  return (
    <div className="rounded-md border border-(--border-hairline) bg-[var(--surface-inset)] p-3 text-xs italic text-(--text-tertiary)">
      No deterministic steps were recorded for this fault.
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: ErrorTabPanel
// ─────────────────────────────────────────────────────────────

export default function ErrorTabPanel({
  errors = { incidents: [], reports: [] }
}: ErrorTabPanelProps) {
  const [expandedStackTrace, setExpandedStackTrace] = useState<Record<string, boolean>>({});

  const errorIncidents = errors?.incidents ?? [];
  // A JS exception / console error arrives as BOTH an incident and a crash
  // report; render the incident once and suppress the mirrored report so each
  // fault is a single card (matching the engine's confirmed-bug count).
  const errorReports = dedupeReportsAgainstIncidents(errorIncidents, errors?.reports ?? []);

  // Collapse identical repeats (same fault re-thrown across the run) into one card
  // with an ×N count — lossless display grouping, nothing is dropped.
  const incidentGroups = groupBySignature(errorIncidents, liveFaultSignature, (i) => i.occurrences ?? 1);
  const reportGroups = groupBySignature(errorReports, liveFaultSignature, (r) => r.occurrences ?? 1);

  return (
    <div className="space-y-4 p-2">
      {incidentGroups.length === 0 && reportGroups.length === 0 ? (
        <div className="text-(--text-secondary) italic py-4">No errors captured yet.</div>
      ) : (
        <>
          {/* INCIDENT CARDS */}
          {incidentGroups.map(({ item: incident, count }, idx) => {
            const incidentKey = `incident-${idx}`;
            const metadata = extractErrorMetadata(incident);
            const isExpanded = expandedStackTrace[incidentKey];

            // 🧠 Safely lookup the context of AI diagnostic fields embedded in incidents
            const aiDiagnostics = (incident as any).aiDiagnostics;

            return (
              <div
                key={incidentKey}
                className="bg-[var(--surface-panel)] border border-(--status-critical-border) rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="bg-[var(--status-critical-bg)] px-4 py-3 flex items-center justify-between border-b border-(--status-critical-border)">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--status-critical-fg)] text-[var(--text-oninvert)] text-xs font-bold">
                      ⚠
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-(--status-critical-fg)">Forensics (Incident)</span>
                        <OccurrenceBadge count={count} />
                      </div>
                      <div className="text-[11px] text-(--status-critical-fg) opacity-75">
                        {metadata.timestamp.split('T')[1]?.slice(0, 8) || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <CopyButton text={incident.reason} label="Error Message" />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-[var(--status-critical-bg)] border-b border-(--status-critical-border)">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Type</div>
                    <div className="text-xs font-mono text-(--status-critical-fg) whitespace-normal break-words">{metadata.type}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Severity</div>
                    <div className="text-xs font-mono text-(--status-critical-fg) capitalize">{metadata.severity}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Source</div>
                    <div className="text-xs font-mono text-(--status-critical-fg)">{metadata.source}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Index</div>
                    <div className="text-xs font-mono text-(--status-critical-fg)">#{idx}</div>
                  </div>
                </div>

                {/* 🏷 Deterministic classification + scenario/step attribution */}
                <AttributionBadges attribution={incident.attribution} />

                {/* 🧭 Human-executable reproduction steps for this incident */}
                <div className="px-4 pt-3">
                  <ReproductionSection steps={incident.reproductionPlaybook} />
                </div>

                {/* 🛠 Suggested Fix — bound directly to this finding's remediation */}
                <div className="px-4 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)">Suggested Fix</div>
                  <SuggestedFixBlock advice={incident.advice} />
                </div>

                <div className="px-4 py-3 bg-[var(--surface-panel)] border-b border-(--status-critical-border) max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-(--text-secondary)">
                    {incident.reason}
                  </div>

                  {/* 🧠 Optional AI enrichment (CWE/severity) when present — additive */}
                  <AiDiagnosticCard ai={aiDiagnostics} />
                </div>

                {incident.stackTrace && (
                  <ExpandableCodeBlock
                    title="Stack Trace"
                    content={incident.stackTrace}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedStackTrace(prev => ({ ...prev, [incidentKey]: !prev[incidentKey] }))}
                    className="max-h-96"
                  />
                )}
              </div>
            );
          })}

          {/* CRASH REPORT CARDS */}
          {reportGroups.map(({ item: report, count }, idx) => {
            const reportKey = `report-${idx}`;
            const metadata = extractErrorMetadata(report);
            const isExpanded = expandedStackTrace[reportKey];
            const aiDiagnostics = (report as any).aiDiagnostics;

            return (
              <div
                key={reportKey}
                className="bg-[var(--surface-panel)] border border-(--status-critical-border) rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="bg-[var(--status-critical-bg)] px-4 py-3 flex items-center justify-between border-b border-(--status-critical-border)">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--status-critical-fg)] text-[var(--text-oninvert)] text-xs font-bold">
                      🔥
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-(--status-critical-fg)">Console Error</span>
                        <OccurrenceBadge count={count} />
                      </div>
                      <div className="text-[11px] text-(--status-critical-fg) opacity-75">
                        {report.timestamp || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <CopyButton text={report.reason} label="Error Message" />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-[var(--status-critical-bg)] border-b border-(--status-critical-border)">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Type</div>
                    <div className="text-xs font-mono text-(--status-critical-fg) whitespace-normal break-words">{metadata.type}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Severity</div>
                    <div className="text-xs font-mono text-(--status-critical-fg) capitalize">{metadata.severity}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Source</div>
                    <div className="text-xs font-mono text-(--status-critical-fg)">{metadata.source}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-(--status-critical-fg) uppercase opacity-75">Index</div>
                    <div className="text-xs font-mono text-(--status-critical-fg)">#{idx}</div>
                  </div>
                </div>

                {/* 🏷 Deterministic classification + scenario/step attribution */}
                <AttributionBadges attribution={report.attribution} />

                {/* 🧭 Human-executable reproduction steps for this crash report */}
                <div className="px-4 pt-3">
                  <ReproductionSection steps={report.reproductionPlaybook} />
                </div>

                {/* 🛠 Suggested Fix — bound directly to this finding's remediation */}
                <div className="px-4 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)">Suggested Fix</div>
                  <SuggestedFixBlock advice={report.advice} />
                </div>

                <div className="px-4 py-3 bg-[var(--surface-panel)] border-b border-(--status-critical-border) max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-(--text-secondary)">
                    {report.reason}
                  </div>

                  <AiDiagnosticCard ai={aiDiagnostics} />
                </div>

                {report.stackTrace && (
                  <ExpandableCodeBlock
                    title="Stack Trace"
                    content={report.stackTrace}
                    isExpanded={isExpanded}
                    onToggle={() => setExpandedStackTrace(prev => ({ ...prev, [reportKey]: !prev[reportKey] }))}
                    className="max-h-96"
                  />
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

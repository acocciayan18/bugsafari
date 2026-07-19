/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import type { IncidentReport, ForensicCrashReport } from '../../types';
import { dedupeReportsAgainstIncidents, groupBySignature, liveFaultSignature } from '../../utils/errorDeduplication';
import ReproductionChecklist from './ReproductionChecklist';
import AiDiagnosticCard from './AiDiagnosticCard';
import { AttributionBadges as AttributionBadgesBase, CopyButton, ExpandableCodeBlock, SeverityBadge, SuggestedFixBlock } from '../common/ForensicCardKit';

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
      className="rounded-full border border-[var(--status-critical-border)] px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-[var(--status-critical-fg)]"
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

/** Original source frames resolved from the target's source maps (best-effort). */
const ResolvedFrames = ({ resolved }: { resolved: string | undefined }) => {
  if (!resolved) return null;
  return (
    <div className="px-4 pt-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)">Original source (via source maps)</div>
      <pre className="rounded-md border border-(--border-hairline) bg-[var(--surface-inset)] p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-(--text-primary)">
        {resolved}
      </pre>
    </div>
  );
};

/** Visual evidence of the viewport captured at the fault instant (base64 JPEG). */
const FaultScreenshot = ({ screenshot }: { screenshot: string | undefined }) => {
  if (!screenshot) return null;
  return (
    <div className="px-4 pt-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)">Screenshot at fault</div>
      <img
        src={`data:image/jpeg;base64,${screenshot}`}
        alt="Viewport at the moment the fault was captured"
        className="w-full rounded-md border border-(--border-hairline)"
        loading="lazy"
      />
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
                className="bg-[var(--surface-panel)] border border-(--border-hairline) border-l-4 border-l-(--status-critical-fg) rounded-lg overflow-hidden"
              >
                <div className="px-4 py-3 flex items-center justify-between border-b border-(--border-hairline)">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-(--status-critical-border) text-(--status-critical-fg) text-xs font-bold">
                      ⚠
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-(--status-critical-fg)">Forensics (Incident)</span>
                        <SeverityBadge severity={incident.severity} />
                        <OccurrenceBadge count={count} />
                      </div>
                      <div className="text-[11px] text-(--text-tertiary)">
                        {metadata.timestamp.split('T')[1]?.slice(0, 8) || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <CopyButton text={incident.reason} label="Error Message" />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-[var(--surface-inset)] border-b border-(--border-hairline)">
                  <MetaCell label="Type" value={metadata.type} />
                  <MetaCell label="Severity" value={incident.severity ?? metadata.severity} />
                  <MetaCell label="Source" value={metadata.source} />
                  <MetaCell label="Index" value={`#${idx}`} />
                </div>

                {/* 🏷 Deterministic classification + scenario/step attribution */}
                <AttributionBadges attribution={incident.attribution} />

                {/* 🧭 Human-executable reproduction steps for this incident */}
                <div className="px-4 pt-3">
                  <ReproductionSection steps={incident.reproductionPlaybook} />
                </div>

                {/* 📸 Visual evidence captured at the fault instant */}
                <FaultScreenshot screenshot={incident.screenshot} />

                {/* 🛠 Suggested Fix — bound directly to this finding's remediation */}
                <div className="px-4 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)">Suggested Fix</div>
                  <SuggestedFixBlock advice={incident.advice} />
                </div>

                <div className="px-4 py-3 bg-[var(--surface-panel)] border-b border-(--border-hairline) max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-(--text-secondary)">
                    {incident.reason}
                  </div>

                  {/* 🧠 Optional AI enrichment (CWE/severity) when present — additive */}
                  <AiDiagnosticCard ai={aiDiagnostics} />
                </div>

                <ResolvedFrames resolved={incident.resolvedStackTrace} />

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
                className="bg-[var(--surface-panel)] border border-(--border-hairline) border-l-4 border-l-(--status-critical-fg) rounded-lg overflow-hidden"
              >
                <div className="px-4 py-3 flex items-center justify-between border-b border-(--border-hairline)">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-(--status-critical-border) text-(--status-critical-fg) text-xs font-bold">
                      🔥
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-(--status-critical-fg)">Console Error</span>
                        <SeverityBadge severity={report.severity} />
                        <OccurrenceBadge count={count} />
                      </div>
                      <div className="text-[11px] text-(--text-tertiary)">
                        {report.timestamp || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <CopyButton text={report.reason} label="Error Message" />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-[var(--surface-inset)] border-b border-(--border-hairline)">
                  <MetaCell label="Type" value={metadata.type} />
                  <MetaCell label="Severity" value={report.severity ?? metadata.severity} />
                  <MetaCell label="Source" value={metadata.source} />
                  <MetaCell label="Index" value={`#${idx}`} />
                </div>

                {/* 🏷 Deterministic classification + scenario/step attribution */}
                <AttributionBadges attribution={report.attribution} />

                {/* 🧭 Human-executable reproduction steps for this crash report */}
                <div className="px-4 pt-3">
                  <ReproductionSection steps={report.reproductionPlaybook} />
                </div>

                {/* 📸 Visual evidence captured at the fault instant */}
                <FaultScreenshot screenshot={report.screenshot} />

                {/* 🛠 Suggested Fix — bound directly to this finding's remediation */}
                <div className="px-4 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--text-secondary)">Suggested Fix</div>
                  <SuggestedFixBlock advice={report.advice} />
                </div>

                <div className="px-4 py-3 bg-[var(--surface-panel)] border-b border-(--border-hairline) max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-(--text-secondary)">
                    {report.reason}
                  </div>

                  <AiDiagnosticCard ai={aiDiagnostics} />
                </div>

                <ResolvedFrames resolved={report.resolvedStackTrace} />

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

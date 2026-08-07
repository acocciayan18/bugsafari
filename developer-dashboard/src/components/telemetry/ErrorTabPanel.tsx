// Live Errors tab — renders the in-flight faults with the SAME card as the saved
// Forensic Report (shared <FindingCard>), so what the operator sees during a run
// is exactly what the report shows after the save. This panel only adds the live
// concerns: report/incident dedup, ×N grouping, and the AI diagnostic block.

import type { IncidentReport, ForensicCrashReport } from '../../types';
import { dedupeReportsAgainstIncidents, groupBySignature, liveFaultSignature } from '../../utils/errorDeduplication';
import { reportableIncidents, reportableReports } from '../../utils/findingRouting';
import { incidentToFindingView, reportToFindingView } from '../../utils/findingView';
import AiDiagnosticCard from './AiDiagnosticCard';
import FindingCard from '../common/FindingCard';

interface ErrorTabPanelProps {
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
}

export default function ErrorTabPanel({
  errors = { incidents: [], reports: [] }
}: ErrorTabPanelProps) {
  // Infrastructure/environment events belong to the Network tab — the shared
  // routing tree decides, so live, replayed and saved views agree.
  const errorIncidents = reportableIncidents(errors?.incidents ?? []);
  // A JS exception / console error arrives as BOTH an incident and a crash
  // report; render the incident once and suppress the mirrored report so each
  // fault is a single card (matching the engine's confirmed-bug count).
  const errorReports = dedupeReportsAgainstIncidents(errorIncidents, reportableReports(errors?.reports ?? []));

  // Collapse identical repeats (same fault re-thrown across the run) into one card
  // with an ×N count — lossless display grouping, nothing is dropped.
  const incidentGroups = groupBySignature<IncidentReport>(errorIncidents, liveFaultSignature, (i) => i.occurrences ?? 1);
  const reportGroups = groupBySignature<ForensicCrashReport>(errorReports, liveFaultSignature, (r) => r.occurrences ?? 1);

  return (
    <div className="flex flex-col gap-4 p-2" role="log" aria-live="assertive" aria-relevant="additions" aria-label="Captured findings">
      {incidentGroups.length === 0 && reportGroups.length === 0 ? (
        <div className="text-(--text-secondary)  py-2">No findings captured yet.</div>
      ) : (
        <>
          {incidentGroups.map(({ item: incident, count }, idx) => (
            <FindingCard
              key={`incident-${liveFaultSignature(incident)}`}
              view={incidentToFindingView(incident, count)}
              index={idx}
              showBypass={false}
            >
              <AiDiagnosticCard ai={incident.aiDiagnostics} />
            </FindingCard>
          ))}

          {reportGroups.map(({ item: report, count }, idx) => (
            <FindingCard
              key={`report-${liveFaultSignature(report)}`}
              view={reportToFindingView(report, count)}
              index={incidentGroups.length + idx}
              showBypass={false}
            >
              <AiDiagnosticCard ai={report.aiDiagnostics} />
            </FindingCard>
          ))}
        </>
      )}
    </div>
  );
}

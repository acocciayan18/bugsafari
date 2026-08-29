// Live Errors tab — renders the in-flight faults with the SAME card as the saved
// Forensic Report (shared <FindingCard>), so what the operator sees during a run
// is exactly what the report shows after the save. This panel only adds the live
// concerns: report/incident dedup, ×N grouping, and the AI diagnostic block.

import type { IncidentReport, ForensicCrashReport } from '../../types';
import { collapseLiveFindings } from '../../utils/liveFindings';
import { ShieldCheck } from 'lucide-react';
import AiDiagnosticCard from './AiDiagnosticCard';
import FindingCard from '../common/FindingCard';
import FindingsPanel, { type FindingEntry } from '../common/FindingsPanel';
import EmptyState from '../common/EmptyState';

interface ErrorTabPanelProps {
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
}

export default function ErrorTabPanel({
  errors = { incidents: [], reports: [] }
}: ErrorTabPanelProps) {
  // ONE canonical projection: infra noise filtered, the incident/report twin collapsed by
  // bugId-or-signature, occurrences authoritative, fields reconciled — the SAME families the
  // saved Forensic Report shows, so the two views never diverge.
  const findings = collapseLiveFindings(errors?.incidents ?? [], errors?.reports ?? []);

  // One entry per finding — the panel filters/sorts/groups by `view` and defers each
  // card back to `render`, so live cards stay identical to the saved report's.
  const entries: FindingEntry[] = findings.map(({ key, view, aiDiagnostics }): FindingEntry => ({
    key,
    view,
    render: (index) => (
      <FindingCard view={view} index={index} showBypass={false}>
        <AiDiagnosticCard ai={aiDiagnostics} />
      </FindingCard>
    ),
  }));

  return (
    <div >
      <FindingsPanel
        entries={entries}
        live
        bare
        emptyState={
          <EmptyState
            Icon={ShieldCheck}
            tone="clean"
            title="No findings yet"
            description="Faults the engine catches while exploring land here. A clean run means nothing broke."
          />
        }
      />
    </div>
  );
}

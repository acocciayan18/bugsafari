// Live Errors tab — renders the in-flight faults with the SAME card as the saved
// Forensic Report (shared <FindingCard>), so what the operator sees during a run
// is exactly what the report shows after the save. This panel only adds the live
// concerns: report/incident dedup, ×N grouping, and the AI diagnostic block.

import type { IncidentReport, ForensicCrashReport } from '../../types';
import { collapseLiveFindings } from '../../utils/liveFindings';
import { ShieldCheck, CircleCheckBig } from 'lucide-react';
import { motion } from 'framer-motion';
import AiDiagnosticCard from './AiDiagnosticCard';
import FindingCard from '../common/FindingCard';
import FindingsPanel, { type FindingEntry } from '../common/FindingsPanel';
import EmptyState from '../common/EmptyState';

interface ErrorTabPanelProps {
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
  // True once the run has ENDED on a healthy outcome with zero findings — turns the
  // neutral "no findings yet" placeholder into a deliberate clean-run closure.
  cleanRun?: boolean;
}

// Deliberate success closure for a finished run that confirmed nothing — a clean result
// should read as an achieved outcome, not the same blank as "nothing happened".
function CleanRunSuccess() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="m-3 flex flex-col items-center gap-2 rounded-xl border border-(--status-stable-border) bg-(--status-stable-bg) px-6 py-10 text-center"
    >
      <CircleCheckBig className="h-8 w-8 text-(--status-stable-fg)" strokeWidth={1.75} aria-hidden="true" />
      <div className="text-[13px] font-semibold text-(--status-stable-fg)">Clean run — no findings</div>
      <div className="text-[13px] text-(--status-stable-fg)">The autonomous run completed without confirming any bugs or vulnerabilities.</div>
    </motion.div>
  );
}

export default function ErrorTabPanel({
  errors = { incidents: [], reports: [] },
  cleanRun = false,
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
          cleanRun ? (
            <CleanRunSuccess />
          ) : (
            <EmptyState
              Icon={ShieldCheck}
              tone="clean"
              title="No findings yet"
              description="Faults the engine catches while exploring land here. A clean run means nothing broke."
            />
          )
        }
      />
    </div>
  );
}

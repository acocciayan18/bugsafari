import type { ForensicCrashReport } from '../../types';
import { mapForensicReportToPlaybook } from '../../utils/semanticInstructionMapper';

interface ForensicTrailProps {
  reports: ForensicCrashReport[];
}

export default function ForensicTrail({ reports }: ForensicTrailProps) {
  if (reports.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-(--border-hairline)">
        <div className="border-b border-(--border-hairline) bg-(--surface-raised) px-4 py-3 text-sm font-medium">
          Forensics (appears after a bug is found)
        </div>
        <div className="h-70 overflow-auto bg-(--surface-panel) p-3 text-sm text-(--text-tertiary)">
          No forensic crash report captured yet.
        </div>
      </div>
    );
  }

  const latest = reports[0];
  const playbook = mapForensicReportToPlaybook(latest);

  return (
    <div className="overflow-hidden rounded-xl border border-(--border-hairline)">
      <div className="border-b border-(--border-hairline) bg-(--surface-raised) px-4 py-3 text-sm font-medium">
        Forensics (Latest Incident)
      </div>

      <div className="h-70 overflow-auto bg-(--surface-panel) p-3 text-sm">
        <article className="rounded-lg border border-(--status-critical-border) bg-(--status-critical-bg) p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-(--status-critical-fg)">{latest.reason}</div>
              <div className="mt-1 text-[13px] text-(--text-secondary)">
                {new Date(latest.timestamp).toLocaleString()}
                {latest.statusCode ? ` • status ${latest.statusCode}` : null}
              </div>
              <div className="mt-1 text-[13px] text-(--text-secondary)">URL: {latest.url}</div>
            </div>
          </div>

<div className="mt-3">
            <div className="text-[13px] font-semibold text-(--text-primary)">Reproduction Playbook</div>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-[13px] text-(--text-secondary)">
              {latest.reproductionPlaybook && latest.reproductionPlaybook.length > 0 ? (
                latest.reproductionPlaybook.map((step, idx) => (
                  <li key={`${step}-${idx}`} className="rounded bg-(--surface-raised) px-2 py-1">
                    {step}
                  </li>
                ))
              ) : playbook.length > 0 ? (
                playbook.map((step) => (
                  <li key={step.stepNumber} className="rounded bg-(--surface-raised) px-2 py-1">
                    Step {step.stepNumber}: {step.instruction}
                  </li>
                ))
              ) : (
                <li className="text-(--text-tertiary)">No reproduction steps available.</li>
              )}
            </ol>
          </div>


          {latest.stackTrace ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-(--text-primary)">Stack Trace</summary>
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-(--surface-panel) p-2 text-[11px] text-(--text-secondary)">
                {latest.stackTrace}
              </pre>
            </details>
          ) : null}
        </article>
      </div>
    </div>
  );
}


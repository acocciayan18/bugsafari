import type { ForensicCrashReport } from '../../types';
import { mapForensicReportToPlaybook } from '../../utils/semanticInstructionMapper';

interface ForensicTrailProps {
  reports: ForensicCrashReport[];
}

export default function ForensicTrail({ reports }: ForensicTrailProps) {
  if (reports.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <div className="border-b border-gray-200 bg-gray-100 px-4 py-3 text-sm font-medium">
          Forensics (appears after a bug is found)
        </div>
        <div className="h-70 overflow-auto bg-white p-3 text-sm text-gray-500">
          No forensic crash report captured yet.
        </div>
      </div>
    );
  }

  const latest = reports[0];
  const playbook = mapForensicReportToPlaybook(latest);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-100 px-4 py-3 text-sm font-medium">
        Forensics (Latest Incident)
      </div>

      <div className="h-70 overflow-auto bg-white p-3 text-sm">
        <article className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-red-800">{latest.reason}</div>
              <div className="mt-1 text-xs text-gray-700">
                {new Date(latest.timestamp).toLocaleString()}
                {latest.statusCode ? ` • status ${latest.statusCode}` : null}
              </div>
              <div className="mt-1 text-xs text-gray-700">URL: {latest.url}</div>
            </div>
          </div>

<div className="mt-3">
            <div className="text-xs font-semibold text-gray-800">Reproduction Playbook</div>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs text-gray-700">
              {latest.reproductionPlaybook && latest.reproductionPlaybook.length > 0 ? (
                latest.reproductionPlaybook.map((step, idx) => (
                  <li key={`${step}-${idx}`} className="rounded bg-gray-100 px-2 py-1">
                    {step}
                  </li>
                ))
              ) : playbook.length > 0 ? (
                playbook.map((step) => (
                  <li key={step.stepNumber} className="rounded bg-gray-100 px-2 py-1">
                    Step {step.stepNumber}: {step.instruction}
                  </li>
                ))
              ) : latest.breadcrumbs.length === 0 ? (
                <li className="text-gray-500">No reproduction steps available.</li>
              ) : (
                latest.breadcrumbs.map((bc, idx) => (
                  <li key={`${bc.timestamp}-${idx}`} className="rounded bg-gray-100 px-2 py-1">
                    Step {idx + 1}: {bc.action} {bc.selector}
                  </li>
                ))
              )}
            </ol>
          </div>


          {latest.stackTrace ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-800">Stack Trace</summary>
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-gray-700">
                {latest.stackTrace}
              </pre>
            </details>
          ) : null}
        </article>
      </div>
    </div>
  );
}


import type { ForensicCrashReport } from '../types';
import { mapForensicReportToPlaybook } from '../utils/semanticInstructionMapper';

interface ForensicTrailProps {
  reports: ForensicCrashReport[];
}

export default function ForensicTrail({ reports }: ForensicTrailProps) {
  if (reports.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
          Forensics (appears after a bug is found)
        </div>
        <div className="h-70 overflow-auto bg-white p-3 text-sm text-slate-500">
          No forensic crash report captured yet.
        </div>
      </div>
    );
  }

  const latest = reports[0];
  const playbook = mapForensicReportToPlaybook(latest);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
        Forensics (Latest Incident)
      </div>

      <div className="h-[280px] overflow-auto bg-white p-3 text-sm">
        <article className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-rose-800">{latest.reason}</div>
              <div className="mt-1 text-xs text-slate-700">
                {new Date(latest.timestamp).toLocaleString()}
                {latest.statusCode ? ` • status ${latest.statusCode}` : null}
              </div>
              <div className="mt-1 text-xs text-slate-700">URL: {latest.url}</div>
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-semibold text-slate-800">Reproduction Playbook (semantic)</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-700">
              {playbook.length === 0 ? (
                latest.breadcrumbs.length === 0 ? (
                  <li className="text-slate-500">No reproduction breadcrumbs available.</li>
                ) : (
                  latest.breadcrumbs.map((bc, idx) => (
                    <li key={`${bc.timestamp}-${idx}`}>
                      Step {idx + 1}: {bc.action} {bc.selector}
                    </li>
                  ))
                )
              ) : (
                playbook.map((step) => (
                  <li key={step.stepNumber}>
                    Step {step.stepNumber}: {step.instruction}
                  </li>
                ))
              )}
            </ol>
          </div>


          <div className="mt-3">
            <div className="text-xs font-semibold text-slate-800">Raw Action Trail (circular buffer)</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-700">
              {latest.breadcrumbs.map((bc, idx) => (
                <li key={`${bc.timestamp}-${idx}`}>
                  Step {idx + 1}: {bc.action} {bc.selector}
                </li>
              ))}
            </ol>
          </div>


          {latest.stackTrace ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-800">Stack Trace</summary>
              <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] text-slate-700">
                {latest.stackTrace}
              </pre>
            </details>
          ) : null}
        </article>
      </div>
    </div>
  );
}


import type { IncidentReport } from '../../types';
import { describeActionRecord } from '../../../../shared/reproduction.js';

interface ReproductionTrailProps {
  incidents: IncidentReport[];
}

export default function ReproductionTrail({ incidents }: ReproductionTrailProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--border-hairline)">
      <div className="border-b border-(--border-hairline) bg-(--surface-raised) px-4 py-3 text-sm font-medium text-(--text-primary)">Reproduction Trail</div>
      <div className="custom-scrollbar max-h-[280px] min-h-[160px] overflow-auto bg-(--surface-panel) p-3 text-sm">
        {incidents.length === 0 ? (
          <p className="text-(--text-secondary)">No incident report captured.</p>
        ) : (
          incidents.map((incident, index) => (
            <article key={`${incident.timestamp}-${index}`} className="mb-4 rounded-lg border border-(--status-critical-border) bg-(--status-critical-bg) p-3">
              <div className="font-semibold text-(--status-critical-fg)">{incident.reason}</div>
              <div className="text-[13px] text-(--status-critical-fg)">{new Date(incident.timestamp).toLocaleString()}</div>
              <div className="mt-1 text-[13px] text-(--text-secondary)">URL: {incident.url}</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-(--text-secondary)">
                {incident.steps.map((step, stepIndex) => (
                  <li key={`${step.timestamp}-${stepIndex}`}>
                    {describeActionRecord(step)} <span className="text-(--text-tertiary)">({toPathname(step.url)})</span>
                  </li>
                ))}
              </ol>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function toPathname(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url || '/';
  }
}

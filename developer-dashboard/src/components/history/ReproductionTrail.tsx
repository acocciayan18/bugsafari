import type { IncidentReport } from '../../types';

interface ReproductionTrailProps {
  incidents: IncidentReport[];
}

export default function ReproductionTrail({ incidents }: ReproductionTrailProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-hairline)]">
      <div className="border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">Reproduction Trail</div>
      <div className="h-[280px] overflow-auto bg-[var(--surface-panel)] p-3 text-sm">
        {incidents.length === 0 ? (
          <p className="text-[var(--text-secondary)]">No incident report captured.</p>
        ) : (
          incidents.map((incident, index) => (
            <article key={`${incident.timestamp}-${index}`} className="mb-4 rounded-lg border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] p-3">
              <div className="font-semibold text-[var(--status-critical-fg)]">{incident.reason}</div>
              <div className="text-xs text-[var(--status-critical-fg)]">{new Date(incident.timestamp).toLocaleString()}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">URL: {incident.url}</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-[var(--text-secondary)]">
                {incident.steps.map((step, stepIndex) => {
                  const target = step.fallbackLabel ? `${step.selector} (${step.fallbackLabel})` : step.selector;
                  const payload = step.payload ? ` with "${step.payload.slice(0, 60)}"` : '';
                  const path = toPathname(step.url);
                  return (
                    <li key={`${step.timestamp}-${stepIndex}`}>
                      Step {stepIndex + 1}: {step.type} {target} on {path}
                      {payload}
                    </li>
                  );
                })}
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

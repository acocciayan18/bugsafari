import type { IncidentReport } from '../../types';

interface ReproductionTrailProps {
  incidents: IncidentReport[];
}

export default function ReproductionTrail({ incidents }: ReproductionTrailProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="border-b border-gray-200 bg-gray-100 px-4 py-3 text-sm font-medium">Reproduction Trail</div>
      <div className="h-[280px] overflow-auto bg-white p-3 text-sm">
        {incidents.length === 0 ? (
          <p className="text-gray-500">No incident report captured.</p>
        ) : (
          incidents.map((incident, index) => (
            <article key={`${incident.timestamp}-${index}`} className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="font-semibold text-red-800">{incident.reason}</div>
              <div className="text-xs text-red-700">{new Date(incident.timestamp).toLocaleString()}</div>
              <div className="mt-1 text-xs text-gray-700">URL: {incident.url}</div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-gray-700">
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

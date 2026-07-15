import type { TelemetryEvent } from '../../types';
import ReproductionChecklist from './ReproductionChecklist';
import AiDiagnosticCard from './AiDiagnosticCard';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface NetworkTabPanelProps {
  events: TelemetryEvent[];
}

// Collapse NETWORK events by method+url+status (preserving first-seen order) so a
// polled endpoint is one row with a repeat count. Shared with the tab badge so the
// header count and the list length always match.
export function dedupeNetworkEvents(events: TelemetryEvent[]): { event: TelemetryEvent; count: number }[] {
  const map = new Map<string, { event: TelemetryEvent; count: number }>();
  for (const event of Array.isArray(events) ? events : []) {
    const m = event.meta;
    const key = `${m?.method ?? 'GET'}|${m?.url ?? ''}|${m?.statusCode ?? ''}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { event, count: 1 });
  }
  return [...map.values()];
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: NetworkTabPanel
// ─────────────────────────────────────────────────────────────

export default function NetworkTabPanel({
  events = []
}: NetworkTabPanelProps) {
  // Dedup (shared with the tab badge), then cap the rendered rows.
  const deduped = dedupeNetworkEvents(events).slice(-50);

  if (deduped.length === 0) {
    return (
      <div className="text-gray-500 py-4">
        <div className="text-gray-800 mb-2 font-bold">Network Diagnostics</div>
        <div className="text-gray-400 italic text-xs leading-relaxed">
          Waiting for network activity...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      <div className="text-gray-800 mb-2 font-bold">Network Diagnostics ({deduped.length})</div>
      {deduped.map(({ event, count }, idx) => {
        const meta = event.meta;
        const statusCode = meta?.statusCode;
        const url = meta?.url || 'unknown';
        const method = meta?.method || 'GET';
        const message = meta?.message || '';
        const aiDiagnostics = meta?.aiDiagnostics || null;
        const reproductionSteps = meta?.reproductionSteps ?? [];

        const isError = statusCode && statusCode >= 400;
        const isServerError = statusCode && statusCode >= 500;
        const isClientError = statusCode && statusCode >= 400 && statusCode < 500;

        const borderColor = isServerError
          ? 'border-red-300'
          : isClientError
            ? 'border-amber-300'
            : 'border-gray-300';
        const bgColor = isServerError
          ? 'bg-red-50'
          : isClientError
            ? 'bg-amber-50'
            : 'bg-white';
        const textColor = isError ? 'text-red-700' : 'text-blue-600';

        return (
          <div
            key={`network-${idx}`}
            className={`border ${borderColor} ${bgColor} rounded-lg overflow-hidden shadow-sm`}
          >
            <div className="px-3 py-2 flex items-center justify-between border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-xs font-bold ${textColor}`}>
                  {method} {statusCode || 'ERR'}
                </span>
                {count > 1 && (
                  <span className="text-[10px] text-gray-500">×{count}</span>
                )}
              </div>
            </div>
            <div className="px-3 py-2 text-xs font-mono text-gray-700 break-all">
              {url}
            </div>
            {(message || aiDiagnostics) && (
              <div className="px-3 py-2 text-[10px] text-gray-500 border-t border-gray-200">
                {message}
                <AiDiagnosticCard ai={aiDiagnostics} />
              </div>
            )}
            {reproductionSteps.length > 0 && (
              <div className="px-3 pb-3 border-t border-gray-200">
                <ReproductionChecklist steps={reproductionSteps} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

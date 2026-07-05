import type { TelemetryEvent } from '../../types';
import ReproductionChecklist from './ReproductionChecklist';
import AiDiagnosticCard from './AiDiagnosticCard';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface NetworkTabPanelProps {
  telemetry: TelemetryEvent[] | string[];
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: NetworkTabPanel
// ─────────────────────────────────────────────────────────────

export default function NetworkTabPanel({
  telemetry = []
}: NetworkTabPanelProps) {
  // Filter to only NETWORK type events
  const networkEvents = (Array.isArray(telemetry) ? telemetry : [])
    .filter((evt): evt is TelemetryEvent => typeof evt !== 'string' && evt?.type === 'NETWORK')
    .slice(-50);

  if (networkEvents.length === 0) {
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
      <div className="text-gray-800 mb-2 font-bold">Network Diagnostics ({networkEvents.length})</div>
      {networkEvents.map((event, idx) => {
        const meta = event.meta;
        const statusCode = meta?.statusCode;
        const url = meta?.url || 'unknown';
        const method = meta?.method || 'GET';
        const duration = meta?.durationMs;
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
                {duration !== undefined && (
                  <span className="text-[10px] text-gray-500">
                    {duration}ms
                  </span>
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

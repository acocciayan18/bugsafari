/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TelemetryEvent, IntelligentDiagnosis } from '../../types';
import ReproductionChecklist from './ReproductionChecklist';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface NetworkTabPanelProps {
  telemetry: TelemetryEvent[] | string[];
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

/**
 * 🧠 AI Diagnostic Card Component
 */
const AiForensicDiagnosticCard = ({ ai }: { ai: IntelligentDiagnosis | null }) => {
  if (!ai) return null;
  return (
    <div className="mt-3 bg-slate-900 border-l-4 border-blue-500 rounded-r p-4 text-slate-200 shadow-md font-mono text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-blue-400 font-bold tracking-wider uppercase text-[10px]">
          <span>🧠 BUGSAFARI FORENSIC EXPERT SYSTEM</span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border ${ai.severity === 'CRITICAL'
            ? 'bg-red-950/80 border-red-800 text-red-400'
            : 'bg-amber-950/80 border-amber-800 text-amber-400'
          }`}>
          {ai.severity}
        </span>
      </div>

      <div className="space-y-2 text-[11px] leading-relaxed">
        <div>
          <span className="text-slate-400 font-bold">Vulnerability Class:</span>{' '}
          <span className="text-white font-bold">{ai.vulnerabilityClass}</span>
        </div>
        <div>
          <span className="text-slate-400 font-bold">Standard Profile:</span>{' '}
          <span className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded text-[10px] font-bold">{ai.cwe}</span>
        </div>
        <div className="text-slate-300 text-justify italic font-light mt-1">
          <span className="text-slate-400 not-italic font-bold">Inference Deduction:</span> {ai.explanation}
        </div>

        {/* Highlighted Clean Actionable Remediation Box */}
        <div className="mt-3 p-2.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded font-sans text-xs">
          <span className="font-mono text-[10px] font-black uppercase tracking-wider block text-emerald-400 mb-1">
            💡 Actionable Remediation Patch Strategy:
          </span>
          <p className="leading-normal">{ai.suggestedFix}</p>
        </div>
      </div>
    </div>
  );
};

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
      <div className="text-slate-500 py-4">
        <div className="text-slate-800 mb-2 font-bold">Network Diagnostics</div>
        <div className="text-slate-400 italic text-xs leading-relaxed">
          Waiting for network activity...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      <div className="text-slate-800 mb-2 font-bold">Network Diagnostics ({networkEvents.length})</div>
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
            : 'border-slate-300';
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
            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-xs font-bold ${textColor}`}>
                  {method} {statusCode || 'ERR'}
                </span>
                {duration !== undefined && (
                  <span className="text-[10px] text-slate-500">
                    {duration}ms
                  </span>
                )}
              </div>
            </div>
            <div className="px-3 py-2 text-xs font-mono text-slate-700 break-all">
              {url}
            </div>
            {(message || aiDiagnostics) && (
              <div className="px-3 py-2 text-[10px] text-slate-500 border-t border-slate-200">
                {message}
                <AiForensicDiagnosticCard ai={aiDiagnostics} />
              </div>
            )}
            {reproductionSteps.length > 0 && (
              <div className="px-3 pb-3 border-t border-slate-200">
                <ReproductionChecklist steps={reproductionSteps} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

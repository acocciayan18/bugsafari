/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo } from 'react';
import type { TelemetryEvent, IntelligentDiagnosis } from '../../types';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface TelemetryLogStreamProps {
  telemetry: TelemetryEvent[] | string[];
  isTestRunning: boolean;
  currentEngineAction?: string;
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
// MAIN COMPONENT: TelemetryLogStream
// ─────────────────────────────────────────────────────────────

export default function TelemetryLogStream({
  telemetry = [],
  isTestRunning = false,
  currentEngineAction = ''
}: TelemetryLogStreamProps) {

  /**
   * Format telemetry events with consistent timestamp, type, and color coding
   */
  const formattedTelemetry = useMemo(() => {
    const events = Array.isArray(telemetry)
      ? telemetry.map((event) => {
        if (typeof event === 'string') {
          return { rawText: event, aiDiagnostics: null };
        }
        // Timestamp display removed for simplified console matching - keeping raw timestamp for database sorting only
        const type = event.type ?? 'EVENT';
        const message = event.meta?.message ?? event.meta?.actionExecuted ?? 'event';

        return {
          rawText: `[${type}] ${message}`,
          aiDiagnostics: event.meta?.aiDiagnostics || null // 🧠 Passing down structured AI metadata
        };
      })
      : [];
    return events.slice(-100);
  }, [telemetry]);

  // Render empty state
  if (formattedTelemetry.length === 0 && !isTestRunning) {
    return (
      <div className="text-slate-600 py-4">
        <span className="text-slate-800">█</span> Ready for telemetry...
      </div>
    );
  }

  // Render with test running
  return (
    <>
      {formattedTelemetry.map((logObj, index) => (
        <div key={index} className="py-1 border-b border-slate-100/50 last:border-0">
          <div
            className={`leading-relaxed whitespace-pre-wrap break-words ${logObj.rawText.includes('[SYSTEM]')
              ? 'text-slate-600'
              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                ? 'text-red-600 font-semibold'
                : logObj.rawText.includes('[NETWORK]')
                  ? 'text-blue-600'
                  : 'text-slate-800'
              }`}
          >
            {logObj.rawText}
          </div>

          {/* 🧠 Contextual Injection of AI Diagnostic Panel inside telemetry live flow */}
          <AiForensicDiagnosticCard ai={logObj.aiDiagnostics} />
        </div>
      ))}
      <div className="flex items-center gap-2 py-2 text-slate-500">
        <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
        <span className="font-mono text-xs">
          {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
        </span>
      </div>
    </>
  );
}

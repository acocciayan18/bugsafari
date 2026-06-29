import { useMemo } from 'react';
import type { TelemetryEvent } from '../../types';
import AiDiagnosticCard from './AiDiagnosticCard';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface TelemetryLogStreamProps {
  telemetry: TelemetryEvent[] | string[];
  isTestRunning: boolean;
  currentEngineAction?: string;
}

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
          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
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

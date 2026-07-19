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
      <div className="text-(--text-secondary) py-4">
        <span className="text-(--text-primary)">█</span> Ready for telemetry...
      </div>
    );
  }

  // Render with test running
  return (
    <>
      {formattedTelemetry.map((logObj, index) => (
        <div key={index} className="py-1 border-b border-(--border-hairline) last:border-0">
          <div
            className={`leading-relaxed whitespace-pre-wrap break-words ${logObj.rawText.includes('[SYSTEM]')
              ? 'text-(--text-secondary)'
              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                ? 'text-(--status-critical-fg) font-semibold'
                : logObj.rawText.includes('[NETWORK]')
                  ? 'text-(--status-neutral-fg)'
                  : 'text-(--text-primary)'
              }`}
          >
            {logObj.rawText}
          </div>

{/* 🧠 Contextual Injection of AI Diagnostic Panel inside telemetry live flow */}
          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
        </div>
      ))}
      <div className="flex items-center gap-2 py-2 text-(--text-secondary)">
        <span className="h-3 w-3 rounded-full bg-(--status-neutral-fg) animate-ping"></span>
        <span className="font-mono text-xs">
          {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
        </span>
      </div>
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// ═══════════════════════════════════════════════════════════════════════
// AiDiagnosticCard.tsx - UNIFIED AI FORENSIC DIAGNOSTIC COMPONENT
// ═══════════════════════════════════════════════════════════════════════
// Reusable component for displaying AI-generated vulnerability diagnostics
// Used by both TelemetryStream and TelemetryLogStream
// Consolidates duplicate code from ClinicalForensicsDashboard

import type { IntelligentDiagnosis } from '../../types';

/**
 * 🧠 Unified AI Diagnostic Card Component
 * Displays BugSafari Expert System vulnerability analysis
 */
const AiDiagnosticCard = ({ ai }: { ai: IntelligentDiagnosis | null }) => {
  if (!ai) return null;

  return (
    <div className="mt-3 bg-slate-900 border-l-4 border-blue-500 rounded-r p-4 text-slate-200 shadow-md font-mono text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-blue-400 font-bold tracking-wider uppercase text-[10px]">
          <span>🧠 BUGSAFARI FORENSIC EXPERT SYSTEM</span>
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border ${
            ai.severity === 'CRITICAL'
              ? 'bg-red-950/80 border-red-800 text-red-400'
              : 'bg-amber-950/80 border-amber-800 text-amber-400'
          }`}
        >
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
          <span className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded text-[10px] font-bold">
            {ai.cwe}
          </span>
        </div>
        <div className="text-slate-300 text-justify italic font-light mt-1">
          <span className="text-slate-400 not-italic font-bold">Inference Deduction:</span>{' '}
          {ai.explanation}
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

export default AiDiagnosticCard;

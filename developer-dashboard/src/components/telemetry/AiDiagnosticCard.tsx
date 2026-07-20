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

  const isCritical = ai.severity === 'CRITICAL';

  return (
    <div
      className={`mt-3 bg-(--surface-inset) border-l-4 rounded-r p-3 sm:p-4 text-(--text-primary) font-mono text-[13px] ${
        isCritical ? 'border-(--status-critical-fg)' : 'border-(--border-strong)'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-(--border-hairline) pb-2 mb-2">
        <div className="flex min-w-0 items-center gap-1.5 text-(--text-secondary) font-bold tracking-wider uppercase text-[11px]">
          <span>🧠 BUGSAFARI FORENSIC EXPERT SYSTEM</span>
        </div>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border ${
            isCritical
              ? 'bg-(--status-critical-bg) border-(--status-critical-border) text-(--status-critical-fg)'
              : 'bg-(--surface-raised) border-(--border-strong) text-(--text-secondary)'
          }`}
        >
          {ai.severity}
        </span>
      </div>

      <div className="space-y-2 text-[11px] leading-relaxed">
        <div>
          <span className="text-(--text-tertiary) font-bold">Vulnerability Class:</span>{' '}
          <span className="text-(--text-primary) font-bold">{ai.vulnerabilityClass}</span>
        </div>
        <div>
          <span className="text-(--text-tertiary) font-bold">Standard Profile:</span>{' '}
          <span className="inline-block max-w-full break-words text-(--text-secondary) bg-(--surface-raised) px-1.5 py-0.5 rounded text-[11px] font-bold">
            {ai.cwe}
          </span>
        </div>
        {/* Justified text opens large word gaps in a ~300px column, so it stays left-aligned. */}
        <div className="text-(--text-secondary) text-left italic font-light mt-1">
          <span className="text-(--text-tertiary) not-italic font-bold">Inference Deduction:</span>{' '}
          {ai.explanation}
        </div>

        {/* Remediation box — flat neutral surface, no color spent on "good news" */}
        <div className="mt-3 p-2.5 bg-(--surface-raised) border border-(--border-hairline) text-(--text-primary) rounded font-sans text-[13px] break-words">
          <span className="font-mono text-[11px] font-black uppercase tracking-wider block text-(--text-secondary) mb-1">
            💡 Actionable Remediation Patch Strategy:
          </span>
          <p className="leading-normal">{ai.suggestedFix}</p>
        </div>
      </div>
    </div>
  );
};

export default AiDiagnosticCard;

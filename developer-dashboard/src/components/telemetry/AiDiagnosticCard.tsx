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
      className={`mt-3 bg-[var(--surface-inset)] border-l-4 rounded-r p-4 text-[var(--text-primary)] font-mono text-xs ${
        isCritical ? 'border-[var(--status-critical-fg)]' : 'border-[var(--border-strong)]'
      }`}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-[var(--text-secondary)] font-bold tracking-wider uppercase text-[10px]">
          <span>🧠 BUGSAFARI FORENSIC EXPERT SYSTEM</span>
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border ${
            isCritical
              ? 'bg-[var(--status-critical-bg)] border-[var(--status-critical-border)] text-[var(--status-critical-fg)]'
              : 'bg-[var(--surface-raised)] border-[var(--border-strong)] text-[var(--text-secondary)]'
          }`}
        >
          {ai.severity}
        </span>
      </div>

      <div className="space-y-2 text-[11px] leading-relaxed">
        <div>
          <span className="text-[var(--text-tertiary)] font-bold">Vulnerability Class:</span>{' '}
          <span className="text-[var(--text-primary)] font-bold">{ai.vulnerabilityClass}</span>
        </div>
        <div>
          <span className="text-[var(--text-tertiary)] font-bold">Standard Profile:</span>{' '}
          <span className="text-[var(--text-secondary)] bg-[var(--surface-raised)] px-1.5 py-0.5 rounded text-[10px] font-bold">
            {ai.cwe}
          </span>
        </div>
        <div className="text-[var(--text-secondary)] text-justify italic font-light mt-1">
          <span className="text-[var(--text-tertiary)] not-italic font-bold">Inference Deduction:</span>{' '}
          {ai.explanation}
        </div>

        {/* Remediation box — flat neutral surface, no color spent on "good news" */}
        <div className="mt-3 p-2.5 bg-[var(--surface-raised)] border border-[var(--border-hairline)] text-[var(--text-primary)] rounded font-sans text-xs">
          <span className="font-mono text-[10px] font-black uppercase tracking-wider block text-[var(--text-secondary)] mb-1">
            💡 Actionable Remediation Patch Strategy:
          </span>
          <p className="leading-normal">{ai.suggestedFix}</p>
        </div>
      </div>
    </div>
  );
};

export default AiDiagnosticCard;

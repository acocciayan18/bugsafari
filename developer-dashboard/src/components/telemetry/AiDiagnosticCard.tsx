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
    <div className="mt-3 bg-[var(--surface-inset)] border-l-4 border-[var(--status-neutral-border)] rounded-r p-4 text-[var(--text-primary)] shadow-md font-mono text-xs">
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-[var(--status-neutral-fg)] font-bold tracking-wider uppercase text-[10px]">
          <span>🧠 BUGSAFARI FORENSIC EXPERT SYSTEM</span>
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border ${
            ai.severity === 'CRITICAL'
              ? 'bg-[var(--status-critical-bg)] border-[var(--status-critical-border)] text-[var(--status-critical-fg)]'
              : 'bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--status-warning-fg)]'
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

        {/* Highlighted Clean Actionable Remediation Box */}
        <div className="mt-3 p-2.5 bg-[var(--status-stable-bg)] border border-[var(--status-stable-border)] text-[var(--status-stable-fg)] rounded font-sans text-xs">
          <span className="font-mono text-[10px] font-black uppercase tracking-wider block text-[var(--status-stable-fg)] mb-1">
            💡 Actionable Remediation Patch Strategy:
          </span>
          <p className="leading-normal">{ai.suggestedFix}</p>
        </div>
      </div>
    </div>
  );
};

export default AiDiagnosticCard;

// ═══════════════════════════════════════════════════════════════
// ForensicCardKit - Shared building blocks for rendering a single
// finding/bug/incident as a cohesive card (copy button, attribution
// badges, expandable code block, suggested-fix block).
// Shared by the live Errors Tab (ErrorTabPanel) and the saved
// Forensic Report page so both present findings identically.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import type { FindingAttribution } from '../../types';
import { Badge } from '../ui/Badge';
import { Copy } from 'lucide-react';

export const copyToClipboard = async (text: string, label = 'Content') => {
  try {
    await navigator.clipboard.writeText(text);
    console.log(`✓ ${label} copied to clipboard`);
  } catch (err) {
    console.error(`Failed to copy ${label}:`, err);
  }
};

/**
 * Copy button component with feedback
 */
export const CopyButton = ({ text, label }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    await copyToClipboard(text, label || 'Content');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[13px] font-medium transition-all hover:bg-(--surface-hover) active:scale-95 text-(--text-secondary) hover:text-(--text-primary)"
      title={`Copy ${label || 'content'} to clipboard`}
    >
      <Copy className="h-3.5 w-3.5" />
      <span className="text-[13px]">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
};

/**
 * Expandable code block component — used for verbose/noisy content (stack
 * traces, raw payloads) that shouldn't be forced open by default.
 */
export const ExpandableCodeBlock = ({
  title,
  content,
  isExpanded,
  onToggle,
  className = ''
}: {
  title: string;
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
}) => {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 sm:px-4 py-3 text-(--text-secondary) hover:bg-(--surface-hover) transition-colors text-[13px] font-semibold border-b border-(--border-hairline)"
      >
        <span className="shrink-0 text-sm">{isExpanded ? '▼' : ''}</span>
        <span className="min-w-0 text-left">{title}</span>
        <span className="ml-auto hidden shrink-0 text-[11px] opacity-60 sm:inline">Click to {isExpanded ? 'collapse' : 'expand'}</span>
      </button>
      {isExpanded && (
        <div className={`custom-scrollbar px-3 sm:px-4 py-3 bg-(--surface-raised) max-h-96 overflow-y-auto border border-(--border-hairline) border-t-0 ${className}`}>
          <pre className="text-[13px] font-mono whitespace-pre-wrap wrap-break-word text-(--text-secondary) leading-relaxed p-3 bg-(--surface-panel) rounded border border-(--border-hairline) overflow-x-auto">
            {content}
          </pre>
          <div className="mt-2 flex justify-end">
            <CopyButton text={content} label={title} />
          </div>
        </div>
      )}
    </div>
  );
};

// Severity → badge tone + label. Unknown/absent severity renders nothing so older
// records (and non-classified faults) stay clean rather than showing a wrong badge.
const SEVERITY_STYLES: Record<string, { cls: string; label: string }> = {
  CRITICAL: { cls: 'border-(--status-critical-border) text-(--status-critical-fg) bg-(--status-critical-bg)/30', label: 'Critical' },
  HIGH: { cls: 'border-(--status-critical-border) text-(--status-critical-fg) bg-(--status-critical-bg)/20', label: 'High' },
  MEDIUM: { cls: 'border-(--status-warning-border) text-(--status-warning-fg) bg-(--status-warning-bg)/25', label: 'Medium' },
  LOW: { cls: 'border-(--status-neutral-border) text-(--status-neutral-fg) bg-(--status-neutral-bg)/25', label: 'Low' },
  INFO: { cls: 'border-(--border-hairline) text-(--text-tertiary)', label: 'Info' },
};

/** Backend-classified severity badge, shared by the live Errors tab and saved report. */
export const SeverityBadge = ({ severity }: { severity?: string }) => {
  const style = severity ? SEVERITY_STYLES[severity.toUpperCase()] : undefined;
  if (!style) return null;
  return (
    <span
      title={`Backend-classified severity: ${style.label}`}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.cls}`}
    >
      {style.label}
    </span>
  );
};

/**
 * Deterministic classification + scenario/step attribution for a finding, bound
 * directly to the knowledge-base FaultClassifier output persisted with the bug.
 * Renders nothing when attribution is absent (older records remain valid).
 */
export const AttributionBadges = ({ attribution }: { attribution?: FindingAttribution }) => {
  if (!attribution?.bugClass) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="danger" className="uppercase tracking-wide">
        <span title="Knowledge-base bug class">{attribution.bugClass}</span>
      </Badge>
      {attribution.scenario && (
        <Badge variant="default" className="uppercase tracking-wide">
          <span title="Scenario that provoked the fault">{attribution.scenario}</span>
        </Badge>
      )}
      {attribution.cwe && (
        <Badge variant="default" className="uppercase tracking-wide">
          <span title="MITRE CWE identifier">{attribution.cwe}</span>
        </Badge>
      )}
      {typeof attribution.stepIndex === 'number' && (
        <Badge variant="default" title="Execution step at fault time">
          Step {attribution.stepIndex}
        </Badge>
      )}
      {attribution.verificationStatus && (
        <Badge
          variant={attribution.verificationStatus === 'CONFIRMED' ? 'danger' : 'default'}
          className="uppercase tracking-wide"
        >
          <span title="Terminal state of the finding-verification pipeline">
            {attribution.verificationStatus.replace(/_/g, ' ')}
            {typeof attribution.confidenceScore === 'number' && ` ${Math.round(attribution.confidenceScore * 100)}%`}
          </span>
        </Badge>
      )}
    </div>
  );
};

/**
 * Per-finding remediation, bound directly to `finding.advice` (the buildRemediation
 * output also persisted on the saved confirmed bug). Rendered as a copyable code
 * block so the Suggested Fix is identical wherever the finding is shown.
 */
export const SuggestedFixBlock = ({ advice }: { advice: string | undefined }) => {
  if (!advice) {
    return (
      <div className="rounded-md border border-(--border-hairline) bg-(--surface-raised) p-3 text-[13px] italic text-(--text-tertiary)">
        No remediation advisory generated for this fault.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-(--border-hairline) bg-(--surface-raised) p-3">
      {/* Copy sits above the text rather than absolutely overlaying it, which clipped wrapped lines when narrow. */}
      <div className="mb-1 flex justify-end">
        <CopyButton text={advice} label="Suggested Fix" />
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-(--text-primary)">{advice}</pre>
    </div>
  );
};

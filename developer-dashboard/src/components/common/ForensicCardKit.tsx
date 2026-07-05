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
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all hover:bg-gray-100 active:scale-95 text-gray-600 hover:text-gray-900"
      title={`Copy ${label || 'content'} to clipboard`}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
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
        className="w-full flex items-center gap-2 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors text-xs font-semibold border-b border-gray-200"
      >
        <span className="text-sm">{isExpanded ? '▼' : '▶'}</span>
        <span>{title}</span>
        <span className="text-[10px] opacity-60 ml-auto">Click to {isExpanded ? 'collapse' : 'expand'}</span>
      </button>
      {isExpanded && (
        <div className={`px-4 py-3 bg-gray-100 max-h-96 overflow-y-auto border border-gray-200 border-t-0 ${className}`}>
          <pre className="text-xs font-mono whitespace-pre-wrap wrap-break-word text-gray-700 leading-relaxed p-3 bg-white rounded border border-gray-200 overflow-x-auto">
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
        <Badge variant="primary" className="uppercase tracking-wide">
          <span title="Scenario that provoked the fault">{attribution.scenario}</span>
        </Badge>
      )}
      {attribution.cwe && (
        <Badge variant="warning" className="uppercase tracking-wide">
          <span title="MITRE CWE identifier">{attribution.cwe}</span>
        </Badge>
      )}
      {typeof attribution.stepIndex === 'number' && (
        <Badge variant="default" title="Execution step at fault time">
          Step {attribution.stepIndex}
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
      <div className="rounded-md border border-gray-200 bg-gray-100 p-3 text-xs italic text-gray-400">
        No remediation advisory generated for this fault.
      </div>
    );
  }
  return (
    <div className="relative rounded-md border border-green-700 bg-slate-900 p-3 shadow-sm">
      <div className="absolute right-2 top-2">
        <CopyButton text={advice} label="Suggested Fix" />
      </div>
      <pre className="whitespace-pre-wrap break-words pr-16 font-mono text-xs leading-relaxed text-green-300">{advice}</pre>
    </div>
  );
};

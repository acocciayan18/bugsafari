// ═══════════════════════════════════════════════════════════════
// ForensicCardKit - Shared building blocks for rendering a single
// finding/bug/incident as a cohesive card (copy button, attribution
// badges, expandable code block, suggested-fix block).
// Shared by the live Errors Tab (ErrorTabPanel) and the saved
// Forensic Report page so both present findings identically.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Copy, Sparkles, Loader2, Info } from 'lucide-react';
import type { BugCategory, RemediationFailureReason, SuggestFixRequest, SuggestFixSource } from '../../../../shared/types.js';
import { BUG_CATEGORY_META } from '../../../../shared/types.js';
import { requestSuggestedFix } from '../../services/historyService';

// Operator-facing cause for a fallback. Shared by the per-finding fix block and the
// session-level AI Insights panel so both explain the same failure the same way.
const FALLBACK_REASON_TEXT: Record<RemediationFailureReason, string> = {
  not_configured: 'Suggested fixes are turned off right now.',
  auth: "Suggested fixes aren't available right now. Try again shortly.",
  rate_limited: 'The service is busy right now. Try again in a moment.',
  model_unavailable: 'Suggested fixes are unavailable right now. Try again shortly.',
  bad_request: "We couldn't generate a suggested fix for this one.",
  provider_error: 'Something went wrong. Try again in a moment.',
  timeout: 'The request took too long to respond. Try again.',
  network: "We couldn't reach the service. Check your connection and try again.",
  invalid_response: "We got back something we couldn't use. Try again.",
  empty_response: "Nothing came back. Try again.",
};

export const fallbackReasonText = (reason?: RemediationFailureReason): string =>
  (reason && FALLBACK_REASON_TEXT[reason]) || 'Suggested fixes are unavailable right now.';

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
      <span className="text-[13px] cursor-pointer">{copied ? 'Copied!' : 'Copy'}</span>
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
        className="w-full flex items-center gap-2 px-4 py-3 text-(--text-secondary) hover:bg-(--surface-hover) transition-colors text-[13px] font-semibold border-b border-(--border-hairline)"
      >
        <span className="shrink-0 text-[13px]">{isExpanded ? '▼' : ''}</span>
        <span className="min-w-0 text-left">{title}</span>
        <span className="ml-auto hidden shrink-0 text-xs opacity-60 sm:inline">Click to {isExpanded ? 'collapse' : 'expand'}</span>
      </button>
      {isExpanded && (
        <div className={`custom-scrollbar px-4 py-3 bg-(--surface-raised) max-h-96 overflow-y-auto border border-(--border-hairline) border-t-0 ${className}`}>
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
      title={`Severity: ${style.label}`}
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${style.cls}`}
    >
      {style.label}
    </span>
  );
};

// Broad bug-family label with an info affordance — the title carries a plain-English
// blurb explaining the family in student-friendly terms. Shared by the live Errors
// tab and the saved report so both label a finding's category identically.
export const CategoryBadge = ({ category }: { category?: BugCategory }) => {
  const meta = category ? BUG_CATEGORY_META[category] : undefined;
  if (!meta) return null;
  return (
    <span
      title={meta.blurb}
      className="inline-flex shrink-0 cursor-help items-center gap-1 rounded-full border border-(--border-hairline) bg-(--surface-inset) px-2 py-0.5 text-xs font-semibold text-(--text-secondary)"
    >
      {meta.label}
      <Info className="h-3 w-3 text-(--text-tertiary)" aria-hidden="true" />
    </span>
  );
};

/**
 * Per-finding remediation. Default source is the deterministic `advice` (the
 * buildRemediation output persisted on the saved bug). When `context` is supplied
 * (saved Forensic Report only) an on-demand "Generate AI Fix" button requests a
 * tailored remediation from the model; the deterministic advice stays the fallback.
 */
export const SuggestedFixBlock = ({ advice, context, savedAiAdvice }: { advice: string | undefined; context?: SuggestFixRequest; savedAiAdvice?: string }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  // Seed from a persisted AI fix so a saved remediation shows immediately on load.
  const [aiAdvice, setAiAdvice] = useState<string | null>(savedAiAdvice || null);
  const [source, setSource] = useState<SuggestFixSource | null>(savedAiAdvice ? 'ai' : null);
  const [reason, setReason] = useState<RemediationFailureReason | undefined>();

  const displayed = aiAdvice ?? advice;

  const generate = async () => {
    if (!context) return;
    setStatus('loading');
    try {
      const result = await requestSuggestedFix({ ...context, fallbackAdvice: advice });
      setAiAdvice(result.advice || advice || null);
      setSource(result.source);
      setReason(result.reason);
      setStatus('idle');
    } catch {
      setReason('network');
      setStatus('error');
    }
  };

  return (
    <div>
      {/* Heading row: label on the left, AI action + copy on the right, all one line. */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-caption font-bold uppercase text-(--text-secondary)">Suggested Fix</span>
        <div className="flex items-center gap-2">
          {/* Generate once per finding: the button is hidden the moment a genuine AI
              fix exists (source === 'ai', incl. a persisted one seeded on load) so we
              never spend an API call regenerating a successful response. It reappears
              only when generation failed or fell back to the knowledge-base fix. */}
          {context && source !== 'ai' && (
            <button
              type="button"
              onClick={generate}
              disabled={status === 'loading'}
              className="inline-flex items-center cursor-pointer gap-1.5 rounded border border-(--border-hairline) bg-(--surface-inset) px-2 py-1 text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) disabled:opacity-60"
            >
              {status === 'loading'
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Generating…</>
                : <><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {status === 'error' || source === 'fallback' ? 'Retry' : 'See More Suggestions'}</>}
            </button>
          )}
          {displayed && <CopyButton text={displayed} label="Suggested Fix" />}
        </div>
      </div>

      {(status === 'error' || (source === 'fallback' && status === 'idle')) && (
        <div className="mb-1.5 text-xs font-medium text-(--status-critical-fg)">
          {fallbackReasonText(reason)} Showing the saved fix instead.
        </div>
      )}

      {/* Content container: the fix text alone, boxed below the heading. */}
      <div className="rounded-md border border-(--border-hairline) bg-(--surface-raised) p-3">
        {displayed
          ? <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-(--text-primary)">{displayed}</pre>
          : <div className="text-[13px] italic text-(--text-tertiary)">{context ? 'No suggested fix yet. Generate one above.' : 'No suggested fix for this finding yet.'}</div>}
      </div>
    </div>
  );
};

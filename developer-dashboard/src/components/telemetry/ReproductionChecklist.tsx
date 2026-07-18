import { useState } from 'react';
import {
  chipClass,
  chipLabel,
  classifyNarrativeLine,
  splitObservations,
  toMarkdownChecklist,
} from '../../utils/reproductionFormat';

/**
 * 🧭 Reproduction Playbook — a high-contrast, numbered checklist of the
 * human-executable steps that led to a captured defect, with a per-step
 * action-type chip and observed results shown apart from the actions.
 * Self-contained so it can render natively inside any defect card.
 *
 * `steps` are fully-formed narrative lines; observation lines carry the shared
 * OBSERVATION_PREFIX and are split into their own block.
 */
export default function ReproductionChecklist({ steps }: { steps: string[] }) {
  const [copied, setCopied] = useState(false);
  const { steps: actions, observations } = splitObservations(steps);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdownChecklist(actions, observations));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ReproductionChecklist] Failed to copy steps:', err);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-inset)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-wider text-[var(--text-secondary)]">
          🧭 Reproduction Playbook
        </div>
        {steps.length > 0 && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-hover)] active:scale-95"
            title="Copy reproduction steps as Markdown"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      {actions.length > 0 ? (
        <ol className="space-y-1.5">
          {actions.map((step, idx) => {
            const kind = classifyNarrativeLine(step);
            return (
              <li
                key={`${idx}-${step}`}
                className="flex items-start gap-2 rounded border border-[var(--border-hairline)] bg-[var(--surface-panel)] px-2.5 py-1.5"
              >
                <span className="mt-px text-[11px] font-mono text-[var(--text-tertiary)]">{idx + 1}</span>
                <span className={`mt-px rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipClass(kind)}`}>
                  {chipLabel(kind)}
                </span>
                <span className="text-xs leading-relaxed text-[var(--text-primary)] break-words">{step}</span>
              </li>
            );
          })}
        </ol>
      ) : observations.length === 0 ? (
        <div className="text-xs italic text-[var(--text-secondary)]">No reproduction steps available.</div>
      ) : null}
      <ObservationsBlock observations={observations} />
    </div>
  );
}

/**
 * Observed RESULTS (crash, inconsistency, drift) rendered apart from the numbered
 * actions — these are things that happened, not steps a human performs.
 */
export function ObservationsBlock({ observations }: { observations: string[] }) {
  if (observations.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--status-critical-fg)]">
        Observed result
      </div>
      <ul className="space-y-1">
        {observations.map((line, idx) => (
          <li
            key={`${idx}-${line}`}
            className="rounded border border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--status-critical-fg)] break-words"
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
          🧭 Reproduction Playbook
        </div>
        {steps.length > 0 && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-amber-800 transition-all hover:bg-amber-100 active:scale-95 dark:text-amber-300 dark:hover:bg-amber-900/40"
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
                className="flex items-start gap-2 rounded border border-amber-200 bg-white px-2.5 py-1.5 dark:border-amber-900 dark:bg-slate-900"
              >
                <span className="mt-px text-[11px] font-mono text-gray-400 dark:text-gray-500">{idx + 1}</span>
                <span className={`mt-px rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipClass(kind)}`}>
                  {chipLabel(kind)}
                </span>
                <span className="text-xs leading-relaxed text-gray-900 break-words dark:text-gray-100">{step}</span>
              </li>
            );
          })}
        </ol>
      ) : observations.length === 0 ? (
        <div className="text-xs italic text-gray-500 dark:text-gray-400">No reproduction steps available.</div>
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
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
        Observed result
      </div>
      <ul className="space-y-1">
        {observations.map((line, idx) => (
          <li
            key={`${idx}-${line}`}
            className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs leading-relaxed text-red-800 break-words dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

import {
  chipClass,
  chipLabel,
  classifyNarrativeLine,
  splitObservations,
} from '../../utils/reproductionFormat';
import ReproNotice from '../common/ReproNotice';

/**
 *  Reproduction Playbook — a high-contrast, numbered checklist of the
 * human-executable steps that led to a captured defect, with a per-step
 * action-type chip and observed results shown apart from the actions.
 * Self-contained so it can render natively inside any defect card.
 *
 * `steps` are fully-formed narrative lines; observation lines carry the shared
 * OBSERVATION_PREFIX and are split into their own block.
 */
export default function ReproductionChecklist({ steps }: { steps: string[] }) {
  const { steps: actions, observations } = splitObservations(steps);

  return (
    <div className="mt-3 rounded-lg border border-(--border-hairline) bg-(--surface-inset) p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-(--text-secondary)">
        Reproduction Playbook
        <ReproNotice />
      </div>
      {actions.length > 0 ? (
        <ol className="space-y-1.5">
          {actions.map((step, idx) => {
            const kind = classifyNarrativeLine(step);
            return (
              <li
                key={`${idx}-${step}`}
                className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded border border-(--border-hairline) bg-(--surface-panel) px-2.5 py-1.5"
              >
                <span className="mt-px shrink-0 text-xs font-mono text-(--text-tertiary)">{idx + 1}</span>
                <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${chipClass(kind)}`}>
                  {chipLabel(kind)}
                </span>
                <span className="w-full min-w-0 text-[13px] leading-relaxed text-(--text-primary) break-words sm:w-auto sm:flex-1">{step}</span>
              </li>
            );
          })}
        </ol>
      ) : observations.length === 0 ? (
        <div className="text-[13px] italic text-(--text-secondary)">No reproduction steps available.</div>
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
      <div className="mb-1 text-xs font-bold uppercase text-(--status-critical-fg)">
        Observed result
      </div>
      <ul className="space-y-1">
        {observations.map((line, idx) => (
          <li
            key={`${idx}-${line}`}
            className="rounded border border-(--status-critical-border) bg-(--status-critical-bg) px-2.5 py-1.5 text-[13px] leading-relaxed text-(--status-critical-fg) break-words"
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

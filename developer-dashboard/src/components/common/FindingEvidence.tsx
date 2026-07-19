// ═══════════════════════════════════════════════════════════════
// FindingEvidence - the shared evidence body for ONE finding.
// Renders reproduction, screenshot, resolved source frames, suggested
// fix, and stack trace identically for the live Errors tab and the
// saved Forensic Report, driven by a normalized FindingView. Each
// caller keeps its own header/chrome; only this evidence block is
// single-sourced, so the two views can never drift in field handling.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import type { ForensicActionStep } from '../../types';
import type { FindingView } from '../../utils/findingView';
import { chipClass, chipLabel, humanizeActionStep, splitObservations } from '../../utils/reproductionFormat';
import ReproductionChecklist, { ObservationsBlock } from '../telemetry/ReproductionChecklist';
import { ExpandableCodeBlock, SuggestedFixBlock } from './ForensicCardKit';

function formatStepTime(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

// Ordered structured trace — one chip row per step (action-type chip + imperative
// instruction + payload code chip). The single source for structured reproduction,
// used by both the per-finding evidence and the saved report's appendix.
export function ActionStepList({ steps }: { steps: ForensicActionStep[] }) {
  return (
    <ol className="max-h-96 space-y-1.5 overflow-y-auto">
      {steps.map((step) => {
        const { kind, instruction, payloadDisplay } = humanizeActionStep(step);
        return (
          <li
            key={step.stepNumber}
            className="flex items-start gap-2 rounded border border-(--border-hairline) bg-(--surface-panel) px-2.5 py-1.5"
          >
            <span className="mt-px text-[11px] font-mono text-(--text-tertiary)">{step.stepNumber}</span>
            <span className={`mt-px rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chipClass(kind)}`}>
              {chipLabel(kind)}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] leading-relaxed text-(--text-primary) break-words">{instruction}</div>
              {payloadDisplay && (
                <code className="mt-1 inline-block max-w-full break-words rounded bg-(--status-critical-bg) px-1.5 py-0.5 font-mono text-[11px] text-(--status-critical-fg)">
                  {payloadDisplay}
                </code>
              )}
              <div className="mt-0.5 text-[10px] text-(--text-tertiary)">
                {typeof step.durationMs === 'number' ? `${step.durationMs}ms · ` : ''}
                {formatStepTime(step.timestamp)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Reproduction: prefer the structured, replayable trace (same timeline Verify Fix
// replays), fall back to the prose checklist, then an empty-state message. Observed
// results live in the narrative steps, so they surface beneath the structured trace.
function Reproduction({ view }: { view: FindingView }) {
  if (view.actionSteps && view.actionSteps.length > 0) {
    return (
      <div>
        <div className="mb-2 text-caption font-bold uppercase tracking-wider text-(--text-secondary)">
          Reproduction Trace ({view.actionSteps.length} steps)
        </div>
        <ActionStepList steps={view.actionSteps} />
        <ObservationsBlock observations={splitObservations(view.reproductionSteps).observations} />
      </div>
    );
  }
  if (view.reproductionSteps.length > 0) {
    return <ReproductionChecklist steps={view.reproductionSteps} />;
  }
  return (
    <div className="rounded-md border border-(--border-hairline) bg-(--surface-inset) p-3 text-[13px] italic text-(--text-tertiary)">
      No deterministic reproduction steps were recorded for this fault.
    </div>
  );
}

export default function FindingEvidence({ view }: { view: FindingView }) {
  const [stackExpanded, setStackExpanded] = useState(false);

  return (
    <>
      {/* Human-executable reproduction */}
      <div className="px-4 pt-3">
        <Reproduction view={view} />
      </div>

      {/* Visual evidence captured at the fault instant (live/replay only) */}
      {view.screenshot && (
        <div className="px-4 pt-3">
          <div className="mb-2 text-caption font-bold uppercase tracking-wider text-(--text-secondary)">Screenshot at fault</div>
          <img
            src={`data:image/jpeg;base64,${view.screenshot}`}
            alt="Viewport at the moment the fault was captured"
            className="w-full rounded-md border border-(--border-hairline)"
            loading="lazy"
          />
        </div>
      )}

      {/* Original source frames resolved from the target's source maps (best-effort) */}
      {view.resolvedStackTrace && (
        <div className="px-4 pt-3">
          <div className="mb-2 text-caption font-bold uppercase tracking-wider text-(--text-secondary)">Original source (via source maps)</div>
          <pre className="rounded-md border border-(--border-hairline) bg-(--surface-inset) p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-(--text-primary)">
            {view.resolvedStackTrace}
          </pre>
        </div>
      )}

      {/* Suggested fix — bound to this finding's remediation */}
      <div className="px-4 pt-3">
        <div className="mb-2 text-caption font-bold uppercase tracking-wider text-(--text-secondary)">Suggested Fix</div>
        <SuggestedFixBlock advice={view.advice} />
      </div>

      {/* Stack trace — disclosure since it's verbose/noisy evidence, not primary narrative */}
      {view.stackTrace && (
        <ExpandableCodeBlock
          title="Stack Trace"
          content={view.stackTrace}
          isExpanded={stackExpanded}
          onToggle={() => setStackExpanded((prev) => !prev)}
          className="max-h-96"
        />
      )}
    </>
  );
}

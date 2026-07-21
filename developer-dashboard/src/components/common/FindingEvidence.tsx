// ═══════════════════════════════════════════════════════════════
// FindingEvidence - the shared evidence body for ONE finding.
// Renders reproduction, resolved source frames, suggested
// fix, and stack trace identically for the live Errors tab and the
// saved Forensic Report, driven by a normalized FindingView. Each
// caller keeps its own header/chrome; only this evidence block is
// single-sourced, so the two views can never drift in field handling.
// ═══════════════════════════════════════════════════════════════

import { useState } from 'react';
import type { ForensicActionStep } from '../../types';
import type { FindingView } from '../../utils/findingView';
import type { RuntimeEvidence } from '../../utils/runtimeEvidence';
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
    <ol className="custom-scrollbar max-h-96 space-y-1.5 overflow-y-auto overscroll-contain">
      {steps.map((step) => {
        const { kind, instruction, payloadDisplay } = humanizeActionStep(step);
        return (
          <li
            key={step.stepNumber}
            className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded border border-(--border-hairline) bg-(--surface-panel) px-2.5 py-1.5"
          >
            <span className="mt-px shrink-0 text-[11px] font-mono text-(--text-tertiary)">{step.stepNumber}</span>
            <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${chipClass(kind)}`}>
              {chipLabel(kind)}
            </span>
            <div className="w-full min-w-0 sm:w-auto sm:flex-1">
              <div className="text-[13px] leading-relaxed text-(--text-primary) break-words">{instruction}</div>
              {payloadDisplay && (
                <code className="mt-1 inline-block max-w-full break-words rounded bg-(--status-critical-bg) px-1.5 py-0.5 font-mono text-[11px] text-(--status-critical-fg)">
                  {payloadDisplay}
                </code>
              )}
              <div className="mt-0.5 text-[11px] text-(--text-tertiary)">
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

// Collapsible per-finding runtime evidence: console errors/warnings and failed
// network requests captured around the fault. Always rendered — an explicit
// empty state tells the developer nothing else fired at fault time.
function RuntimeEvidenceSection({ evidence }: { evidence: RuntimeEvidence }) {
  const [isOpen, setIsOpen] = useState(false);
  const total = evidence.console.length + evidence.network.length;

  if (total === 0) {
    return (
      <div className="rounded-md border border-(--border-hairline) bg-(--surface-inset) px-3 py-2 text-[13px] italic text-(--text-tertiary)">
        No console errors or failed network requests were captured around this fault.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-(--border-hairline)">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between bg-(--surface-inset) px-3 py-2 text-left transition-colors hover:bg-(--surface-hover)"
      >
        <span className="text-caption font-bold uppercase tracking-wider text-(--text-secondary)">
          Runtime Evidence ({evidence.console.length} console · {evidence.network.length} network)
        </span>
        <span className="text-[13px] text-(--text-tertiary)">{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && (
        <div className="space-y-2 border-t border-(--border-hairline) bg-(--surface-panel) p-3">
          {evidence.console.map((row, i) => (
            <div key={`c-${i}`} className="rounded border border-(--border-hairline) bg-(--surface-inset) p-2">
              <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase ${
                row.level === 'error'
                  ? 'bg-(--status-critical-bg) text-(--status-critical-fg)'
                  : 'bg-(--status-warning-bg) text-(--status-warning-fg)'
              }`}>
                {row.level}
              </span>
              <div className="mt-1 break-words font-mono text-[11px] text-(--text-primary)">{row.message}</div>
              {row.stackTrace && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-(--surface-panel) p-2 font-mono text-[11px] text-(--text-secondary)">
                  {row.stackTrace}
                </pre>
              )}
            </div>
          ))}
          {evidence.network.map((row, i) => (
            <div key={`n-${i}`} className="rounded border border-(--border-hairline) bg-(--surface-inset) p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-(--surface-invert) px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase text-(--text-oninvert)">{row.method}</span>
                <span className="font-mono text-[11px] font-bold text-(--status-critical-fg)">
                  {typeof row.statusCode === 'number' ? `HTTP ${row.statusCode}` : 'FAILED'}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-(--text-secondary)" title={row.url}>{row.url}</div>
              {row.message && <div className="mt-1 break-words text-[13px] text-(--text-primary)">{row.message}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FindingEvidence({ view, evidence }: { view: FindingView; evidence?: RuntimeEvidence }) {
  const [stackExpanded, setStackExpanded] = useState(false);

  return (
    <>
      {/* Human-executable reproduction */}
      <div className="px-3 pt-3 sm:px-4">
        <Reproduction view={view} />
      </div>

      {/* Console/network context captured around the fault (explicit empty state when none) */}
      {evidence && (
        <div className="px-3 pt-3 sm:px-4">
          <RuntimeEvidenceSection evidence={evidence} />
        </div>
      )}

      {/* Original source frames resolved from the target's source maps (best-effort) */}
      {view.resolvedStackTrace && (
        <div className="px-3 pt-3 sm:px-4">
          <div className="mb-2 text-caption font-bold uppercase tracking-wider text-(--text-secondary)">Original source (via source maps)</div>
          <pre className="rounded-md border border-(--border-hairline) bg-(--surface-inset) p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-(--text-primary)">
            {view.resolvedStackTrace}
          </pre>
        </div>
      )}

      {/* Suggested fix — bound to this finding's remediation */}
      <div className="px-3 pt-3 sm:px-4">
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

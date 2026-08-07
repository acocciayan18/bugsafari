// ═══════════════════════════════════════════════════════════════
// FindingEvidence - the shared evidence body for ONE finding.
// Renders reproduction, resolved source frames, suggested
// fix, and stack trace identically for the live Errors tab and the
// saved Forensic Report, driven by a normalized FindingView. Mounted
// by the shared <FindingCard>, which owns the header/metadata above it.
// ═══════════════════════════════════════════════════════════════

import { useState, type ReactNode } from 'react';
import type { ForensicActionStep } from '../../types';
import type { SuggestFixRequest } from '../../../../shared/types.js';
import type { FindingView } from '../../utils/findingView';
import { chipClass, chipLabel, humanizeActionStep, splitObservations } from '../../utils/reproductionFormat';
import { formatReportTime } from '../../utils/datetime';
import ReproductionChecklist, { ObservationsBlock } from '../telemetry/ReproductionChecklist';
import { ExpandableCodeBlock, SuggestedFixBlock } from './ForensicCardKit';

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
            <span className="mt-px shrink-0 text-xs font-mono text-(--text-tertiary)">{step.stepNumber}</span>
            <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase  ${chipClass(kind)}`}>
              {chipLabel(kind)}
            </span>
            <div className="w-full min-w-0 sm:w-auto sm:flex-1">
              <div className="text-[13px] leading-relaxed text-(--text-primary) break-words">{instruction}</div>
              {payloadDisplay && (
                <code className="mt-1 inline-block max-w-full break-words rounded bg-(--status-critical-bg) px-1.5 py-0.5 font-mono text-xs text-(--status-critical-fg)">
                  {payloadDisplay}
                </code>
              )}
              <div className="mt-0.5 text-xs text-(--text-tertiary)">
                {typeof step.durationMs === 'number' ? `${step.durationMs}ms · ` : ''}
                {formatReportTime(step.timestamp)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// One label/value row of the bypass metadata grid. Values render in a code chip so
// selectors, payloads and endpoints stay monospaced and copy-clean.
function BypassRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase  text-(--text-tertiary)">{label}</div>
      <div className="mt-0.5 text-[13px] leading-relaxed text-(--text-primary) break-words">{children}</div>
    </div>
  );
}

const Chip = ({ text }: { text: string }) => (
  <code className="inline-block max-w-full break-words rounded bg-(--surface-panel) px-1.5 py-0.5 font-mono text-[13px] text-(--text-secondary)">
    {text}
  </code>
);

// Structured constraint-bypass evidence — the exact field, payload, stripped guard
// and accepting endpoint, so a developer never parses them out of the prose summary.
function BypassDetails({ bypass }: { bypass: NonNullable<FindingView['bypass']> }) {
  const payload = bypass.payload === '' ? '""' : bypass.payload;
  return (
    <div>
      <div className="mb-2 text-caption font-bold uppercase r text-(--text-secondary)">Bypass Details</div>
      <div className="grid grid-cols-1 gap-3 rounded-md border border-(--border-hairline) bg-(--surface-inset) p-3 sm:grid-cols-2">
        <BypassRow label="Target element">{bypass.element}</BypassRow>
        <BypassRow label="Bypass action">
          Stripped <Chip text={bypass.strippedAttribute} />, then submitted
        </BypassRow>
        <BypassRow label="Payload"><Chip text={payload} /></BypassRow>
        <BypassRow label="Endpoint">
          <Chip text={`${bypass.method} ${bypass.endpoint}`} />
        </BypassRow>
        <BypassRow label="Response">
          <span className="font-mono text-(--status-critical-fg)">HTTP {bypass.status}</span>, and the value was accepted
        </BypassRow>
      </div>
    </div>
  );
}

// Reproduction: prefer the structured, replayable trace (same timeline Verify Fix
// replays), fall back to the prose checklist, then an empty-state message. Observed
// results live in the narrative steps, so they surface beneath the structured trace.
function Reproduction({ view }: { view: FindingView }) {
  if (view.actionSteps && view.actionSteps.length > 0) {
    return (
      <div>
        <div className="mb-2 text-caption font-bold uppercase r text-(--text-secondary)">
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
      No steps to reproduce this finding were recorded.
    </div>
  );
}

// Fault context for the on-demand AI remediation call — derived once from the view.
// sessionId + bugId let the server persist an AI result so it survives a refresh.
function toSuggestFixContext(view: FindingView, sessionId?: string): SuggestFixRequest {
  return {
    bugClass: view.attribution?.bugClass ?? view.title,
    message: view.message,
    severity: view.severity,
    cwe: view.attribution?.cwe,
    elementLabel: view.elementLabel,
    stackTrace: view.resolvedStackTrace ?? view.stackTrace,
    payloadUsed: view.payloadUsed,
    reproductionSteps: view.reproductionSteps,
    sessionId,
    bugId: view.bugId,
  };
}

// `showBypass` is presentation-only: the live Errors tab suppresses the bypass grid
// to stay compact during a run — the data is untouched and the saved report shows it.
// `aiFix` gates the on-demand AI remediation button — enabled on the saved report only.
export default function FindingEvidence({ view, showBypass = true, aiFix = false, sessionId }: { view: FindingView; showBypass?: boolean; aiFix?: boolean; sessionId?: string }) {
  const [stackExpanded, setStackExpanded] = useState(false);

  return (
    <>
      {/* Structured bypass evidence — constraint-bypass findings only */}
      {showBypass && view.bypass && (
        <div className="px-4 pt-3">
          <BypassDetails bypass={view.bypass} />
        </div>
      )}

      {/* Human-executable reproduction */}
      <div className="px-4 pt-3">
        <Reproduction view={view} />
      </div>

      {/* Original source frames resolved from the target's source maps (best-effort) */}
      {view.resolvedStackTrace && (
        <div className="px-4 pt-3">
          <div className="mb-2 text-caption font-bold uppercase r text-(--text-secondary)">Original source (via source maps)</div>
          <pre className="rounded-md border border-(--border-hairline) bg-(--surface-inset) p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-(--text-primary)">
            {view.resolvedStackTrace}
          </pre>
        </div>
      )}

      {/* Suggested fix — bound to this finding's remediation */}
      <div className="px-4 pt-3">
        <div className="mb-2 text-caption font-bold uppercase r text-(--text-secondary)">Suggested Fix</div>
        <SuggestedFixBlock advice={view.advice} savedAiAdvice={view.aiAdvice} context={aiFix ? toSuggestFixContext(view, sessionId) : undefined} />
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

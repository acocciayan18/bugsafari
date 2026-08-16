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
import { chipClass, chipLabel, humanizeActionStep, whereSegments } from '../../utils/reproductionFormat';
import ReproductionChecklist from '../telemetry/ReproductionChecklist';
import { ExpandableCodeBlock, SuggestedFixBlock } from './ForensicCardKit';

// Per-step WHERE context — labeled segments (Route / container kind / Element) so a
// developer knows exactly where to act. The first token of each segment is its label
// (Route, Form, Modal, Element…); the remainder is the value.
function StepContext({ segments }: { segments: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words">
      {segments.map((seg, i) => {
        const sp = seg.indexOf(' ');
        const label = sp === -1 ? seg : seg.slice(0, sp);
        const value = sp === -1 ? '' : seg.slice(sp + 1);
        return (
          <span key={`${i}-${seg}`} className="inline-flex items-baseline gap-x-1">
            {i > 0 && <span className="text-(--text-tertiary)">·</span>}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-(--text-tertiary)">{label}</span>
            {value && <span className="text-xs text-(--text-secondary)">{value}</span>}
          </span>
        );
      })}
    </div>
  );
}

// Ordered structured trace — one chip row per step (action-type chip + imperative
// instruction + labeled WHERE context + payload code chip). The single source for
// structured reproduction, used by both the per-finding playbook and the saved
// report's appendix. `perStepContext` shows the WHERE on every step (the playbook);
// left off, it shows only on change so a long run-timeline stays compact.
export function ActionStepList({ steps, perStepContext = false }: { steps: ForensicActionStep[]; perStepContext?: boolean }) {
  let lastWhere = '';
  return (
    <ol className="custom-scrollbar max-h-80 sm:max-h-96 space-y-1.5 overflow-y-auto overscroll-auto scroll-smooth">
      {steps.map((step) => {
        const { kind, instruction, payloadDisplay, where } = humanizeActionStep(step);
        const segments = whereSegments(where);
        const line = segments.join(' · ');
        const showWhere = line !== '' && (perStepContext || line !== lastWhere);
        if (line) lastWhere = line;
        return (
          <li
            key={step.stepNumber}
            className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded border border-(--border-hairline) bg-(--surface-panel) px-2.5 py-1.5"
          >
            <span className="mt-px shrink-0 text-xs font-mono text-(--text-tertiary)">{step.stepNumber}</span>
            <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${chipClass(kind)}`}>
              {chipLabel(kind)}
            </span>
            <div className="w-full min-w-0 sm:w-auto sm:flex-1">
              <div className="text-[13px] leading-relaxed text-(--text-primary) break-words">{instruction}</div>
              {showWhere && <StepContext segments={segments} />}
              {payloadDisplay && (
                <code title={payloadDisplay} className="mt-1 inline-block max-w-full break-words rounded bg-(--status-critical-bg) px-1.5 py-0.5 font-mono text-xs text-(--status-critical-fg)">
                  {payloadDisplay}
                </code>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Structured reproduction playbook — the per-finding surface. Renders the WHERE-rich
// action trace (route + container/form + target element per step) inside the same
// chrome as the string-narrative ReproductionChecklist, so a saved finding tells the
// developer exactly where to perform each step.
function StructuredReproductionPlaybook({ steps }: { steps: ForensicActionStep[] }) {
  return (
    <div className="mt-3 rounded-lg border border-(--border-hairline) bg-(--surface-inset) p-3">
      <div className="mb-2 text-xs font-bold uppercase text-(--text-secondary)">Reproduction Playbook</div>
      <ActionStepList steps={steps} perStepContext />
    </div>
  );
}

// One label/value row of the bypass metadata grid. Values render in a code chip so
// selectors, payloads and endpoints stay monospaced and copy-clean.
function BypassRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase text-(--text-tertiary)">{label}</div>
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
      <div className="mb-2 text-caption font-bold uppercase text-(--text-secondary)">Bypass Details</div>
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

// Reproduction: the per-finding playbook. Saved findings carry the structured trace
// (view.actionSteps), so they render the WHERE-rich playbook — route + container/form +
// target element inline per step. Live faults have only the narrative strings, which
// already weave route/section into prose, so they fall back to the checklist. Both read
// the same shared step voice; the report's appendix still shows the full run timeline.
function Reproduction({ view }: { view: FindingView }) {
  if (view.actionSteps && view.actionSteps.length > 0) {
    return <StructuredReproductionPlaybook steps={view.actionSteps} />;
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
          <div className="mb-2 text-caption font-bold uppercase text-(--text-secondary)">Original source (via source maps)</div>
          <pre className="rounded-md border border-(--border-hairline) bg-(--surface-inset) p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-(--text-primary)">
            {view.resolvedStackTrace}
          </pre>
        </div>
      )}

      {/* Suggested fix — bound to this finding's remediation (heading + copy live in the block) */}
      <div className="px-4 pt-3">
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

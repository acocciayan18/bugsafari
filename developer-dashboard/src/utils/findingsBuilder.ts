// utils/findingsBuilder.ts
// Live → History parity: builds the saved-history findings array from the exact
// incidents and crash reports the operator saw live. Extracted verbatim from
// useDashboardController so the transformation is reusable and testable in
// isolation (no React/state dependencies).
import type { ForensicCrashReport, IncidentReport } from '../types';
import type { SaveFindingPayload } from '../services/historyService';
import { mapIncidentStepsToPlaybook, mapForensicReportToPlaybook, type PlaybookStep } from './semanticInstructionMapper';
import { collapseLiveFindings } from './liveFindings';

// ── Live → History parity helpers ───────────────────────────────────────────
// Serialize a playbook into a sequentially numbered, human-readable checklist,
// matching exactly what the live Error Tab renders.
function formatChecklist(steps: PlaybookStep[]): string[] {
  return steps.map((s) => `Step ${s.stepNumber}: ${s.instruction}`);
}

// Templated remediation checklist (diagnostic-layer placeholder) — clean & copyable.
function generateSuggestedFix(type: string, reason: string, statusCode?: number): string {
  if (type === 'NETWORK') {
    return [
      `Suggested fix for a ${statusCode ?? 'network'} failure`,
      `1. Verify endpoint health and response for: ${reason}`,
      `2. Add retry with backoff and a user-facing error state`,
      `3. Guard the call site against null / timeout responses`,
    ].join('\n');
  }
  return [
    `Suggested fix for a runtime exception`,
    `1. Reproduce via the checklist above`,
    `2. Wrap the failing operation in try/catch; add a null guard before: ${reason}`,
    `3. Add a regression test asserting the element/handler stays stable`,
  ].join('\n');
}

function classifyFinding(statusCode?: number): string {
  return typeof statusCode === 'number' && statusCode >= 400 ? 'NETWORK' : 'EXCEPTION';
}

// Build the findings array transferred on save from the EXACT collapsed families the live
// Findings tab renders (collapseLiveFindings) — one slot per fault, twin already merged,
// severity/occurrences reconciled — so the client payload equals the displayed set and the
// backend re-collapse stays idempotent. Infra noise is already filtered by the collapse.
export function buildLiveFindings(incidents: IncidentReport[], reports: ForensicCrashReport[]): SaveFindingPayload[] {
  return collapseLiveFindings(incidents, reports).map((finding, i) => {
    const fault = finding.representative;
    const view = finding.view;
    const isIncident = finding.kind === 'incident';
    const checklist = fault.reproductionPlaybook && fault.reproductionPlaybook.length > 0
      ? fault.reproductionPlaybook
      : formatChecklist(isIncident
          ? mapIncidentStepsToPlaybook((fault as IncidentReport).steps)
          : mapForensicReportToPlaybook(fault as ForensicCrashReport));
    const type = classifyFinding(fault.statusCode);
    return {
      bugId: `finding-${i + 1}`,
      type,
      message: fault.reason,
      // Culprit from the reconciled VIEW, not the raw representative twin: the "Add" the
      // operator saw may live on a NON-representative member, so serializing off the
      // representative dropped it from the saved payload. endpointLabel rides culpritLabel
      // too — the backend re-splits it via isApiEndpointLabel.
      selector: view.selector ?? '',
      culpritLabel: view.elementLabel ?? view.endpointLabel,
      // Carried so the save-time family collapse keys on the SAME signature the live view did.
      url: fault.url,
      statusCode: fault.statusCode,
      payloadUsed: '',
      stackTrace: fault.stackTrace ?? '',
      reproductionSteps: checklist,
      // Carry the replayable timeline + fault-time state so a queue-mode save preserves what
      // Verify Fix replays (engine memory is empty cross-process); reports carry neither.
      ...(isIncident
        ? { reproductionActions: (fault as IncidentReport).reproductionActions, stateFingerprint: (fault as IncidentReport).stateFingerprint }
        : {}),
      // Prefer the knowledge-base remediation bound to this finding; fall back to the local
      // template only for legacy faults lacking classifier advice.
      advice: fault.advice ?? generateSuggestedFix(type, fault.reason, fault.statusCode),
      timestamp: fault.timestamp,
      attribution: fault.attribution,
      // Reconciled worst-tier severity across the family (see collapseLiveFindings).
      severity: finding.severity,
    };
  });
}

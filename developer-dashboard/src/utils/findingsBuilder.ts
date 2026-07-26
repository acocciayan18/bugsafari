// utils/findingsBuilder.ts
// Live → History parity: builds the saved-history findings array from the exact
// incidents and crash reports the operator saw live. Extracted verbatim from
// useDashboardController so the transformation is reusable and testable in
// isolation (no React/state dependencies).
import type { ForensicCrashReport, IncidentReport } from '../types';
import type { SaveFindingPayload } from '../services/historyService';
import { mapIncidentStepsToPlaybook, mapForensicReportToPlaybook, type PlaybookStep } from './semanticInstructionMapper';
import { dedupeReportsAgainstIncidents } from './errorDeduplication';
// Same culprit resolution the live cards render, so the saved Selector is the one
// the operator already saw.
import { resolveCulprit } from './findingView';

// ── Live → History parity helpers ───────────────────────────────────────────
// Serialize a playbook into a sequentially numbered, human-readable checklist,
// matching exactly what the live Error Tab renders.
function formatChecklist(steps: PlaybookStep[]): string[] {
  return steps.map((s) => `Step ${s.stepNumber}: ${s.instruction}`);
}

// Templated remediation snippet (diagnostic-layer placeholder) — clean & copyable.
function generateSuggestedFix(type: string, reason: string, statusCode?: number): string {
  if (type === 'NETWORK') {
    return [
      `// Suggested remediation — ${statusCode ?? 'network'} failure`,
      `// 1. Verify endpoint health / response for: ${reason}`,
      `// 2. Add retry with backoff and a user-facing error state`,
      `// 3. Guard the call site against null / timeout responses`,
    ].join('\n');
  }
  return [
    `// Suggested remediation — runtime exception`,
    `// 1. Reproduce via the checklist above`,
    `// 2. Wrap the failing operation in try/catch; add a null guard before: ${reason}`,
    `// 3. Add a regression test asserting the element/handler stays stable`,
  ].join('\n');
}

function classifyFinding(statusCode?: number): string {
  return typeof statusCode === 'number' && statusCode >= 400 ? 'NETWORK' : 'EXCEPTION';
}

// Build the complete, uncompressed findings array from the exact incidents and
// crash reports the operator saw live — no dedup, no filter, no truncation.
export function buildLiveFindings(incidents: IncidentReport[], reports: ForensicCrashReport[]): SaveFindingPayload[] {
  const fromIncidents: SaveFindingPayload[] = incidents.map((inc, i) => {
    const checklist = inc.reproductionPlaybook && inc.reproductionPlaybook.length > 0
      ? inc.reproductionPlaybook
      : formatChecklist(mapIncidentStepsToPlaybook(inc.steps));
    const type = classifyFinding(inc.statusCode);
    return {
      bugId: `incident-${i + 1}`,
      type,
      message: inc.reason,
      selector: resolveCulprit(inc.culpritSelector, inc.steps) ?? '',
      payloadUsed: '',
      stackTrace: inc.stackTrace ?? '',
      reproductionSteps: checklist,
      // Carry the replayable timeline + fault-time state so a queue-mode save
      // preserves what Verify Fix replays (engine memory is empty cross-process).
      reproductionActions: inc.reproductionActions,
      stateFingerprint: inc.stateFingerprint,
      // Prefer the knowledge-base remediation bound to this finding; fall back to
      // the local template only for legacy incidents lacking classifier advice.
      advice: inc.advice ?? generateSuggestedFix(type, inc.reason, inc.statusCode),
      timestamp: inc.timestamp,
      attribution: inc.attribution,
      severity: inc.severity,
    };
  });

  // Drop crash reports that mirror an incident so the transferred findings match
  // the de-duplicated live Errors Tab (one slot per fault).
  const uniqueReports = dedupeReportsAgainstIncidents(incidents, reports);
  const fromReports: SaveFindingPayload[] = uniqueReports.map((rep, i) => {
    const checklist = rep.reproductionPlaybook && rep.reproductionPlaybook.length > 0
      ? rep.reproductionPlaybook
      : formatChecklist(mapForensicReportToPlaybook(rep));
    const type = classifyFinding(rep.statusCode);
    return {
      bugId: `report-${i + 1}`,
      type,
      message: rep.reason,
      selector: resolveCulprit(rep.culpritSelector, rep.breadcrumbs) ?? '',
      payloadUsed: '',
      stackTrace: rep.stackTrace ?? '',
      reproductionSteps: checklist,
      // Prefer the knowledge-base remediation bound to this finding (see above).
      advice: rep.advice ?? generateSuggestedFix(type, rep.reason, rep.statusCode),
      timestamp: rep.timestamp,
      attribution: rep.attribution,
      severity: rep.severity,
    };
  });

  return [...fromIncidents, ...fromReports];
}

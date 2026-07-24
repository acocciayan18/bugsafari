// utils/findingView.ts
// ONE normalized finding shape both the live Errors tab (IncidentReport /
// ForensicCrashReport) and the saved report (ForensicCaughtBug) map into, so the
// field-rename divergence (reasonmessage, reproductionPlaybookreproductionSteps,
// breadcrumbs/stepsactionSteps) is resolved once here instead of in every renderer.
// The shared <FindingEvidence> component renders a FindingView; each card keeps its
// own header/chrome (live: incident/console header; saved: number badge
// + Verify-Fix control).
import type {
  ForensicActionStep,
  ForensicCaughtBug,
  ForensicCrashReport,
  IncidentReport,
} from '../types';
import type { ConstraintBypassDetail, FindingAttribution } from '../../../shared/types.js';
import { liveFaultSignature } from './errorDeduplication';

export interface FindingView {
  /** Shared fault identity (same signature used for dedup + grouping). */
  key: string;
  /** Headline — the knowledge-base bug class, falling back to a generic label. */
  title: string;
  /** Primary human-readable fault text (reason ≡ message). */
  message: string;
  severity?: string;
  occurrences: number;
  timestamp?: string;
  url?: string;
  selector?: string;
  payloadUsed?: string;
  stackTrace?: string;
  resolvedStackTrace?: string;
  /** Narrative reproduction playbook (reproductionPlaybook ≡ reproductionSteps). */
  reproductionSteps: string[];
  /** Structured, replayable trace — present on saved findings only. */
  actionSteps?: ForensicActionStep[];
  advice?: string;
  attribution?: FindingAttribution;
  /** Structured constraint-bypass evidence — drives the finding card's metadata grid. */
  bypass?: ConstraintBypassDetail;
}

// The element the fault attaches to = the last real selector in the timeline
// (navigation / page-level steps carry no selector).
function culpritSelector(steps: Array<{ selector?: string }> | undefined): string | undefined {
  if (!steps) return undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]?.selector;
    if (s && s.trim() && s !== 'N/A') return s;
  }
  return undefined;
}

export function incidentToFindingView(inc: IncidentReport, occurrences = inc.occurrences ?? 1): FindingView {
  return {
    key: liveFaultSignature(inc),
    title: inc.attribution?.bugClass || 'Runtime Incident',
    message: inc.reason,
    severity: inc.severity,
    occurrences,
    timestamp: inc.timestamp,
    url: inc.url,
    selector: culpritSelector(inc.steps),
    stackTrace: inc.stackTrace,
    resolvedStackTrace: inc.resolvedStackTrace,
    reproductionSteps: inc.reproductionPlaybook ?? [],
    advice: inc.advice,
    attribution: inc.attribution,
    bypass: inc.bypass,
  };
}

export function reportToFindingView(rep: ForensicCrashReport, occurrences = rep.occurrences ?? 1): FindingView {
  return {
    key: liveFaultSignature(rep),
    title: rep.attribution?.bugClass || 'Console Error',
    message: rep.reason,
    severity: rep.severity,
    occurrences,
    timestamp: rep.timestamp,
    url: rep.url,
    selector: culpritSelector(rep.breadcrumbs),
    stackTrace: rep.stackTrace,
    resolvedStackTrace: rep.resolvedStackTrace,
    reproductionSteps: rep.reproductionPlaybook ?? [],
    advice: rep.advice,
    attribution: rep.attribution,
  };
}

export function caughtBugToFindingView(bug: ForensicCaughtBug, occurrences = bug.occurrences ?? 1): FindingView {
  return {
    key: bug.bugId,
    title: bug.attribution?.bugClass || bug.type || 'UNKNOWN',
    message: bug.message,
    severity: bug.severity,
    occurrences,
    timestamp: bug.timestamp,
    selector: bug.selector,
    payloadUsed: bug.payloadUsed,
    stackTrace: bug.stackTrace,
    resolvedStackTrace: bug.resolvedStackTrace,
    reproductionSteps: bug.reproductionSteps ?? [],
    actionSteps: bug.actionSteps,
    advice: bug.advice,
    attribution: bug.attribution,
    bypass: bug.bypass,
  };
}

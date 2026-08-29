// utils/liveFindings.ts
// ONE canonical live projection for the Telemetry → Findings tab, mirroring the saved
// path's family collapse so the live cards and Forensic History agree card-for-card.
// The engine streams one JS fault as a forensic-report PLUS a synthesized incident twin
// sharing its bugId; the two land in separate store buffers and their content (severity,
// statusCode, stack, culprit) drifts, so a signature-only bridge left both rendered. This
// unifies both buffers and groups by bugId-OR-signature: the twin collapses on its shared
// bugId even when the signature drifted, while genuinely distinct manifestations that
// share a signature still merge — exactly the families the backend collapse forms.
import type { ForensicCrashReport, IncidentReport } from '../types';
import {
  incidentToFindingView,
  reportToFindingView,
  resolveCulpritPair,
  resolveEndpointLabel,
  type FindingView,
} from './findingView';
import { liveFaultSignature } from './errorDeduplication';
import { reportableIncidents, reportableReports } from './findingRouting';
import { pickFaultRepresentative, type RepresentativeFault } from '../../../shared/faultRepresentative.js';
import { resolveSeverity, worstSeverity, type FaultSeverity } from '../../../shared/types.js';

type LiveFault = IncidentReport | ForensicCrashReport;
type Tagged =
  | { kind: 'incident'; fault: IncidentReport }
  | { kind: 'report'; fault: ForensicCrashReport };

export interface LiveFinding {
  key: string;
  view: FindingView;
  // Representative raw fault, for save serialization (carries reproductionActions +
  // stateFingerprint the FindingView drops).
  representative: LiveFault;
  kind: 'incident' | 'report';
  occurrences: number;
  severity: FaultSeverity;
  aiDiagnostics?: IncidentReport['aiDiagnostics'];
}

// The human playbook is the live equivalent of a saved finding's reproductionSteps, so
// the buffer picks the SAME representative the backend collapse does.
const representativeOf = (fault: LiveFault): RepresentativeFault => ({
  reproductionSteps: fault.reproductionPlaybook,
  timestamp: fault.timestamp,
});

const severityOf = (fault: LiveFault): FaultSeverity =>
  resolveSeverity({
    severity: fault.severity,
    bugClass: fault.attribution?.bugClass,
    confidence: fault.attribution?.confidence,
    verificationStatus: fault.attribution?.verificationStatus,
    statusCode: fault.statusCode,
  });

const viewOf = (t: Tagged, occurrences: number): FindingView =>
  t.kind === 'incident' ? incidentToFindingView(t.fault, occurrences) : reportToFindingView(t.fault, occurrences);

// The culprit steps timeline differs by surface — incidents carry `steps`, reports
// `breadcrumbs` — so dispatch before resolving the label/selector/endpoint pair.
const culpritStepsOf = (t: Tagged) => (t.kind === 'incident' ? t.fault.steps : t.fault.breadcrumbs);

export function collapseLiveFindings(
  incidents: IncidentReport[],
  reports: ForensicCrashReport[],
): LiveFinding[] {
  const items: Tagged[] = [
    ...reportableIncidents(incidents ?? []).map((fault): Tagged => ({ kind: 'incident', fault })),
    ...reportableReports(reports ?? []).map((fault): Tagged => ({ kind: 'report', fault })),
  ];

  // Single-pass union by bugId OR signature. byBug/bySig map an id to its group index;
  // an item joins the first group it shares either key with, else opens a new group.
  const groups: Tagged[][] = [];
  const byBug = new Map<string, number>();
  const bySig = new Map<string, number>();
  for (const item of items) {
    const bug = (item.fault.bugId ?? '').trim();
    const sig = liveFaultSignature(item.fault);
    let gi: number | undefined;
    if (bug && byBug.has(bug)) gi = byBug.get(bug);
    else if (bySig.has(sig)) gi = bySig.get(sig);
    if (gi === undefined) {
      gi = groups.length;
      groups.push([]);
    }
    groups[gi].push(item);
    if (bug) byBug.set(bug, gi);
    bySig.set(sig, gi);
  }

  return groups.map((members) => {
    // Same physical events across the two origins ⇒ MAX, never sum (each store buffer has
    // already summed within its own origin via the authoritative per-bugId count).
    const occurrences = members.reduce((max, m) => Math.max(max, m.fault.occurrences ?? 1), 1);
    const rep = pickFaultRepresentative(members, (m) => representativeOf(m.fault));
    const severity = worstSeverity(members.map((m) => severityOf(m.fault)));
    const view: FindingView = { ...viewOf(rep, occurrences), severity };

    // Canonical culprit: prefer a member with a label, else any with a selector
    // (representative first), with Element AND API-Endpoint derived from that ONE record —
    // so the pair never splits and a twin that resolved the control fills the blank the
    // representative left.
    const source = [rep, ...members].find((m) => (m.fault.culpritLabel ?? '').trim() !== '')
      ?? [rep, ...members].find((m) => (m.fault.culpritSelector ?? '').trim() !== '');
    if (source) {
      const pair = resolveCulpritPair(source.fault.culpritLabel, source.fault.culpritSelector, culpritStepsOf(source));
      view.elementLabel = pair.label;
      view.selector = pair.selector;
      // Element wins over endpoint (matches FindingCard); an endpoint shows only with no control.
      view.endpointLabel = pair.label ? undefined : resolveEndpointLabel(source.fault.culpritLabel);
    }

    return {
      key: rep.fault.bugId?.trim() || view.key,
      view,
      representative: rep.fault,
      kind: rep.kind,
      occurrences,
      severity,
      aiDiagnostics: rep.fault.aiDiagnostics,
    };
  });
}

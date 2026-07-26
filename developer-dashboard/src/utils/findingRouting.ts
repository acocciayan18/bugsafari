// Client-side application of the SAME routing tree the engine uses
// (shared/types/telemetryRouting.ts). The engine already filters infrastructure
// noise out of the finding stream; this is the second half of the contract, so a
// legacy record, a queued transfer, or a replayed session can never put a DNS
// failure or a defensive 4xx on the Errors tab.

import { isPromotableReason, routeFindingPayload } from '../../../shared/types.js';
import type { ForensicCrashReport, IncidentReport } from '../types';

// A fault whose headline reads like a network event. Runtime exceptions, races and
// injections never match, so they always stay findings.
const NETWORK_HEADLINE = /^(?:HTTP\s+\d{3}\b|network request failed)/i;

export interface RoutableFinding {
  reason?: string;
  statusCode?: number;
  url?: string;
  attribution?: { routingReason?: string; bugClass?: string };
  stackTrace?: string;
}

/**
 * True when a finding belongs in Findings/Errors. Prefers the routing code the
 * engine recorded; falls back to re-running the tree over the payload for records
 * saved before that field existed.
 */
export function isReportableFinding(finding: RoutableFinding): boolean {
  const routingReason = finding.attribution?.routingReason;
  if (routingReason) return isPromotableReason(routingReason);

  const message = finding.reason ?? '';
  const looksNetwork = NETWORK_HEADLINE.test(message.trim()) || typeof finding.statusCode === 'number';
  if (!looksNetwork) return true;

  return routeFindingPayload({
    type: 'NETWORK',
    statusCode: finding.statusCode,
    url: finding.url,
    message,
  }).promote;
}

/** Keep only the incidents that the shared tree considers actionable. */
export function reportableIncidents(incidents: IncidentReport[]): IncidentReport[] {
  return incidents.filter(isReportableFinding);
}

/** Keep only the crash reports that the shared tree considers actionable. */
export function reportableReports(reports: ForensicCrashReport[]): ForensicCrashReport[] {
  return reports.filter(isReportableFinding);
}

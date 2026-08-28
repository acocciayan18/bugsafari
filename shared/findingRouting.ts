// ═══════════════════════════════════════════════════════════════
// shared/findingRouting.ts - REPORTABILITY PREDICATE (single source)
// ═══════════════════════════════════════════════════════════════
// The one predicate deciding whether a fault belongs in Findings/Errors, shared by
// the live dashboard filter and the backend persistence collapse so a saved history
// holds EXACTLY the findings the operator saw live (no infra/harness noise on one
// side but not the other). Prefers the routing code the engine recorded; falls back
// to re-running the tree over the payload for records saved before that field existed.

import { isHarnessArtifact, isInfrastructureFailure, isPromotableReason, NON_APPLICATION_ORIGINS, routeFindingPayload } from './types/telemetryRouting.js';
import type { ForensicCrashReport, IncidentReport } from './types/bug.js';

// A fault whose headline reads like a network event. Runtime exceptions, races and
// injections never match, so they always stay findings.
const NETWORK_HEADLINE = /^(?:HTTP\s+\d{3}\b|network request failed)/i;

export interface RoutableFinding {
  reason?: string;
  statusCode?: number;
  url?: string;
  attribution?: { routingReason?: string; bugClass?: string; origin?: string };
  stackTrace?: string;
}

export function isReportableFinding(finding: RoutableFinding): boolean {
  // Provenance is authoritative: a fault attributed to Playwright, the environment,
  // BugSafari itself, or a browser extension is never a target-app finding.
  const origin = finding.attribution?.origin;
  if (origin && NON_APPLICATION_ORIGINS.has(origin)) return false;

  const routingReason = finding.attribution?.routingReason;
  if (routingReason) return isPromotableReason(routingReason);

  const message = finding.reason ?? '';
  // Fallback for unclassified/legacy records carrying no provenance: suppress
  // engine-level exceptions (page.goto timeouts, closed contexts, launch failures)
  // and infra/environment failures so they never reach the Errors tab.
  const text = message.toLowerCase();
  if (isHarnessArtifact(text, (finding.url ?? '').toLowerCase()) || isInfrastructureFailure(text)) return false;

  const looksNetwork = NETWORK_HEADLINE.test(message.trim()) || typeof finding.statusCode === 'number';
  if (!looksNetwork) return true;

  return routeFindingPayload({
    type: 'NETWORK',
    statusCode: finding.statusCode,
    url: finding.url,
    message,
  }).promote;
}

// Keep only the incidents the shared tree considers actionable.
export function reportableIncidents(incidents: IncidentReport[]): IncidentReport[] {
  return incidents.filter(isReportableFinding);
}

// Keep only the crash reports the shared tree considers actionable.
export function reportableReports(reports: ForensicCrashReport[]): ForensicCrashReport[] {
  return reports.filter(isReportableFinding);
}

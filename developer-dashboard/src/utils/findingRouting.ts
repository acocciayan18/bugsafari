// Re-export of the shared reportability predicate (shared/findingRouting.ts) so the
// live Errors tab and the backend persistence collapse run the IDENTICAL routing tree
// by construction, not by two copies kept in sync. A DNS failure or a defensive 4xx
// can never land on Findings on one surface but not the other.
export { isReportableFinding, reportableIncidents, reportableReports } from '../../../shared/findingRouting.js';
export type { RoutableFinding } from '../../../shared/findingRouting.js';

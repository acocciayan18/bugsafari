// Auto Save gate — a run is worth persisting only if it produced at least one
// finding, a genuine network failure, or a console error. Reuses the same
// predicates the Errors/Network/Console tabs apply so "has results" matches
// exactly what the operator sees on the dashboard.
import type { IncidentReport, ForensicCrashReport, TelemetryEvent, BrowserConsoleMessage } from '../types';
import { collapseLiveFindings } from './liveFindings';
import { isShownNetworkFailure } from './networkLogBuilder';

export interface RunResultSignals {
  incidents: IncidentReport[];
  reports: ForensicCrashReport[];
  networkEvents: TelemetryEvent[];
  browserConsole: BrowserConsoleMessage[];
}

export function hasMeaningfulRunResults({ incidents, reports, networkEvents, browserConsole }: RunResultSignals): boolean {
  if (collapseLiveFindings(incidents, reports).length > 0) return true;
  if (networkEvents.some((event) => isShownNetworkFailure(event.meta))) return true;
  if (browserConsole.some((log) => log.level === 'error')) return true;
  return false;
}

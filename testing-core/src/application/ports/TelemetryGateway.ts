import type { DiscoveredElement, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';

export interface TelemetryGateway {
  emitTelemetry(event: TelemetryEvent): void;
  emitTargets(targets: DiscoveredElement[]): void;
  emitLiveFrame(base64Jpeg: string): void;
  emitForensicReport(report: ForensicCrashReport): void;
  emitIncidentReport(report: IncidentReport): void;

  /** Specialized socket event for dashboard URL bar updates. */
  emitUrlChanged(url: string): void;


}


import type { Server } from 'socket.io';
import type { DiscoveredElement, EngineMilestoneEvent, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';

export class SocketTelemetryGateway implements TelemetryGateway {
  constructor(private readonly io: Server) {}

  public emitTelemetry(event: TelemetryEvent): void {
    this.io.emit('telemetry', event);
  }

  public emitUrlChanged(url: string): void {
    this.io.emit('url-changed', url);
  }


  public emitTargets(targets: DiscoveredElement[]): void {
    this.io.emit('discovered-elements', targets);
  }

  public emitLiveFrame(base64Jpeg: string): void {
    this.io.emit('live-frame', base64Jpeg);
  }

  public emitForensicReport(report: ForensicCrashReport): void {
    this.io.emit('forensic-report', report);
    this.emitIncidentReport({
      timestamp: report.timestamp,
      reason: report.reason,
      statusCode: report.statusCode,
      url: report.url,
      stackTrace: report.stackTrace,
      steps: report.breadcrumbs.map((item) => ({
        timestamp: item.timestamp,
        type: item.action.includes('input') ? 'INPUT' : item.action.includes('hover') ? 'HOVER' : 'CLICK',
        selector: item.selector,
        url: report.url,
        payload: item.payload,
      })),
    });
  }

  public emitIncidentReport(report: IncidentReport): void {
    this.io.emit('incident-report', report);
  }

  public emitEngineMilestone(event: EngineMilestoneEvent): void {
    this.io.emit('engine-milestone', event);
  }
}

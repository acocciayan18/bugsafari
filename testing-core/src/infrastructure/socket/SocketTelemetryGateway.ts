import type { Server } from 'socket.io';
import type { DiscoveredElement, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';

/** Outbound wire channels the recorder buffers for reconnect replay. */
export type TelemetryRecordKind = 'telemetry' | 'url-changed' | 'live-frame' | 'forensic-report' | 'incident-report';

/** Sink that captures every outbound payload so a returning client can be replayed. */
export interface TelemetryRecorder {
  record(kind: TelemetryRecordKind, payload: unknown): void;
}

export class SocketTelemetryGateway implements TelemetryGateway {
  // When set, emits are scoped to this Socket.IO room instead of broadcast to
  // every connected socket — the run-scoped wire that makes future per-tenant
  // isolation a config change rather than a rewrite. Null preserves the legacy
  // broadcast behavior (no active run).
  private room: string | null = null;
  private recorder: TelemetryRecorder | null = null;

  constructor(private readonly io: Server) { }

  /** Bind/clear the active run's room (set at run start, cleared at run end). */
  public setRoom(room: string | null): void {
    this.room = room;
  }

  /** Bind/clear the ring-buffer recorder for the active run. */
  public setRecorder(recorder: TelemetryRecorder | null): void {
    this.recorder = recorder;
  }

  // Room-scoped emitter when a run owns the wire, otherwise a plain broadcast.
  private channel(): Pick<Server, 'emit'> {
    return this.room ? this.io.to(this.room) : this.io;
  }

  public emitTelemetry(event: TelemetryEvent): void {
    this.recorder?.record('telemetry', event);
    this.channel().emit('telemetry', event);
  }

  public emitUrlChanged(url: string): void {
    this.recorder?.record('url-changed', url);
    this.channel().emit('url-changed', url);
  }

  public emitTargets(targets: DiscoveredElement[]): void {
    this.channel().emit('discovered-elements', targets);
  }

  public emitLiveFrame(base64Jpeg: string): void {
    this.recorder?.record('live-frame', base64Jpeg);
    this.channel().emit('live-frame', base64Jpeg);
  }

  public emitForensicReport(report: ForensicCrashReport): void {
    this.recorder?.record('forensic-report', report);
    this.channel().emit('forensic-report', report);
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
      // Forward the frozen steps + remediation so the synthesized incident is a
      // full copy, not a degraded one missing the playbook/fix.
      reproductionPlaybook: report.reproductionPlaybook,
      advice: report.advice,
    });
  }

  public emitIncidentReport(report: IncidentReport): void {
    this.recorder?.record('incident-report', report);
    this.channel().emit('incident-report', report);
  }
}

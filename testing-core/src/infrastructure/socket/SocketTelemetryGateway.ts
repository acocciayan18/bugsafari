import type { Server } from 'socket.io';
import type { AccessibilityFinding, DiscoveredElement, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';
import { ACCESSIBILITY_EVENT } from '../../../../shared/types.js';
import type { BrowserConsoleMessage, TelemetryGateway } from '../../application/ports/TelemetryGateway.js';

/** Outbound wire channels the recorder buffers for reconnect replay. */
export type TelemetryRecordKind = 'telemetry' | 'url-changed' | 'live-frame' | 'forensic-report' | 'incident-report' | 'accessibility';

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

  // WCAG findings ride their own channel so the dashboard's Accessibility tab
  // listens in isolation — never mixed into the generic Error/telemetry streams.
  public emitAccessibility(finding: AccessibilityFinding): void {
    this.recorder?.record('accessibility', finding);
    this.channel().emit(ACCESSIBILITY_EVENT, finding);
  }

  // Live-only: browser console is transient telemetry (not a saved finding), so it
  // streams to attached clients without buffering for reconnect replay.
  public emitBrowserConsole(message: BrowserConsoleMessage): void {
    this.channel().emit('browser-console', message);
  }
}

import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { TelemetryEvent, TelemetryMeta, TelemetryType } from '@bugsafari/shared';
import type { DecisionRationale, DiscoveredElement, ForensicCrashReport, IncidentReport, TelemetryEvent as TelemetryEventType } from '../../../../shared/types.ts';
import { DECISION_RATIONALE_EVENT } from '../../../../shared/types.js';

interface BrowserConsoleMessage {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  url?: string;
  line?: number;
}

export class TelemetryHub {
  private readonly io: Server;


  constructor(server: HttpServer) {
    this.io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.io.on('connection', (socket) => {
      console.log(`[Socket] Dashboard connected: ${socket.id}`);

      socket.on('disconnect', () => {
        console.log(`[Socket] Dashboard disconnected: ${socket.id}`);
      });
    });
  }

  emitBrowserConsole(message: BrowserConsoleMessage): void {
    this.io.emit('browser-console', message);
  }

  // TelemetryGateway interface implementation
  emitTelemetry(event: TelemetryEventType): void {
    this.io.emit('telemetry', event);
    this.io.emit('engine-log', event);
  }

  emitTargets(targets: DiscoveredElement[]): void {
    this.io.emit('discovered-elements', targets);
  }

  emitLiveFrame(base64Jpeg: string): void {
    this.io.emit('live-frame', base64Jpeg);
  }

  emitForensicReport(report: ForensicCrashReport): void {
    this.io.emit('forensic-report', report);
  }

  emitIncidentReport(report: IncidentReport): void {
    this.io.emit('incident-report', report);
  }

  emitDecisionRationale(rationale: DecisionRationale): void {
    this.io.emit(DECISION_RATIONALE_EVENT, rationale);
  }

emitUrlChanged(url: string): void {
    this.io.emit('url-changed', url);
  }

  // Legacy methods for backward compatibility
  emitTelemetryLegacy(type: TelemetryType, meta: TelemetryMeta): TelemetryEvent {
    const event: TelemetryEvent = {
      timestamp: new Date().toISOString(),
      type,
      meta,
    };

    this.io.emit('telemetry', event);
    this.io.emit('engine-log', event);
    return event;
  }

  emitFrame(base64Image: string): void {
    this.io.emit('live-frame', base64Image);
  }

  emitTargetsLegacy(targets: readonly unknown[]): void {
    this.io.emit('discovered-elements', targets);
  }
}

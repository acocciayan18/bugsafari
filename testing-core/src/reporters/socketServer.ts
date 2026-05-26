import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { TelemetryEvent, TelemetryMeta, TelemetryType } from '../contracts.js';
import type { EngineMilestoneEvent, IncidentReport, ForensicCrashReport } from '../../../shared/types.ts';



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

  emitTelemetry(type: TelemetryType, meta: TelemetryMeta): TelemetryEvent {
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

  emitTargets(targets: readonly unknown[]): void {
    this.io.emit('discovered-elements', targets);
  }

  emitIncidentReport(report: IncidentReport): void {
    this.io.emit('incident-report', report);
  }

  emitForensicReport(report: ForensicCrashReport): void {
    this.io.emit('forensic-report', report);
  }

  emitEngineMilestone(event: EngineMilestoneEvent): void {
    this.io.emit('engine-milestone', event);
  }
}



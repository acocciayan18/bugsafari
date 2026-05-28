import type { ForensicCrashReport, IncidentReport, SessionHistoryEntry, TelemetryEvent } from '../../types';

export interface EngineGateway {
  connect(): void;
  disconnect(): void;
  onConnected(handler: (connected: boolean) => void): void;
  onTelemetry(handler: (event: TelemetryEvent) => void): void;
  onForensicReport(handler: (report: ForensicCrashReport) => void): void;
  onIncidentReport(handler: (report: IncidentReport) => void): void;
  onLiveFrame(handler: (base64Jpeg: string) => void): void;
  onUrlChanged(handler: (url: string) => void): void;
  removeAllListeners(): void;
  startTest(targetUrl: string): Promise<void>;
  saveSession(targetUrl: string): Promise<void>;
  fetchSessionHistory(limit?: number): Promise<SessionHistoryEntry[]>;
}


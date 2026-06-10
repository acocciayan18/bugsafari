import type { ForensicCrashReport, IncidentReport, SessionHistoryEntry, TelemetryEvent } from '../../types';

export interface BrowserConsoleMessage {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  url?: string;
  line?: number;
}

export interface EngineGateway {
  connect(): void;
  disconnect(): void;
  onConnected(handler: (connected: boolean) => void): void;
  onTelemetry(handler: (event: TelemetryEvent) => void): void;
  onForensicReport(handler: (report: ForensicCrashReport) => void): void;
  onIncidentReport(handler: (report: IncidentReport) => void): void;
  onLiveFrame(handler: (base64Jpeg: string) => void): void;
  onUrlChanged(handler: (url: string) => void): void;
  onBrowserConsole(handler: (message: BrowserConsoleMessage) => void): void;
  removeAllListeners(): void;
  startTest(targetUrl: string): Promise<void>;
  saveSession(targetUrl: string): Promise<void>;
  fetchSessionHistory(limit?: number): Promise<SessionHistoryEntry[]>;
  // Flow Control Methods
  pauseTest(): void;
  resumeTest(): void;
  stopTest(): void;
}


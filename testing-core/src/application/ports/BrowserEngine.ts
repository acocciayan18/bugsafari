import type { TelemetryGateway } from './TelemetryGateway.js';

export interface BrowserEngine {
  run(targetUrl: string, telemetry: TelemetryGateway): Promise<{ completed: boolean; reason: string }>;
  pause?(): void;
  resume?(): void;
  stop?(): Promise<void> | void;
  getConfirmedBugs?(): Array<{
    timestamp: string;
    type: string;
    message: string;
    url: string;
    stackTrace?: string;
    severity?: string;
  }>;
}

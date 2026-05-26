import type { TelemetryGateway } from './TelemetryGateway.js';

export interface BrowserEngine {
  run(targetUrl: string, telemetry: TelemetryGateway): Promise<{ completed: boolean; reason: string }>;
}

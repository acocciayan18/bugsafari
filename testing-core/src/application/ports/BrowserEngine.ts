import type { TelemetryGateway } from './TelemetryGateway.js';
import type { OptimizationSettings } from '../../../../developer-dashboard/src/types.js';

export interface BrowserEngineConfig {
  maxActions?: number;
}

export interface BrowserEngine {
  run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings): Promise<{ completed: boolean; reason: string }>;
  pause?(): void;
  resume?(): void;
  stop?(): Promise<void> | void;
  getConfirmedBugsFromMemory?(): Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: Date;
  }>;
  getConfig?(): BrowserEngineConfig;
}

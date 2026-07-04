import type { TelemetryGateway } from './TelemetryGateway.js';
import type { OptimizationSettings, defaultOptimizationSettings, TestingTypeId } from '../../../../shared/types.js';

export interface BrowserEngineConfig {
  maxActions?: number;
}

export interface BrowserEngine {
  run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], userId?: string): Promise<{ completed: boolean; reason: string }>;
  pause?(): void;
  resume?(): void;
  stop?(): Promise<void> | void;
  /** Get the accumulated active execution time in milliseconds. Only counts time when NOT paused. */
  getElapsedActiveTimeMs?(): number;
  /** Check if timebox has been exceeded. Returns true only when elapsed time >= timeboxMs AND NOT paused. */
  isTimeboxExceeded?(timeboxMs?: number): boolean;
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
  /** DB session id of the most recently started run (survives after run() returns). Null for guests/in-memory runs. */
  getLastSessionId?(): string | null;
}

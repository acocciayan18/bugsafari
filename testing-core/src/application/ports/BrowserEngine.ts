import type { TelemetryGateway } from './TelemetryGateway.js';
import type { OptimizationSettings, defaultOptimizationSettings, StopReason, TargetAuthConfig, TestingTypeId } from '../../../../shared/types.js';
import type { RunResult } from '../../domain/services/exploration/types.js';

export interface BrowserEngineConfig {
  maxActions?: number;
}

export interface BrowserEngine {
  /** `targetAuth` is ephemeral: in-memory for this run only, never persisted or logged. */
  run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings, selectedScenarios?: TestingTypeId[], userId?: string, targetAuth?: TargetAuthConfig): Promise<RunResult>;
  /** Public RUN- code to stamp on this run's DB session doc, so live/history share one id. Call before run(). */
  setRunCode?(runCode: string): void;
  pause?(): void;
  resume?(): void;
  /** `reason` names the trigger so the terminal outcome is attributed to its real cause. */
  stop?(reason?: StopReason): Promise<void> | void;
  /** Flush in-flight fire-and-forget telemetry/DB writes; the Pause/Stop settlement barrier. */
  settlePendingTasks?(): Promise<void>;
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
  /** Distinct routes/URLs visited during the most recent run — session-global page set for history metadata. */
  getVisitedRoutes?(): string[];
  /** DB session id of the most recently started run (survives after run() returns). Null for guests/in-memory runs. */
  getLastSessionId?(): string | null;
}

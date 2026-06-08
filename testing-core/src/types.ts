import type { DiscoveredElement, ForensicCrashReport, TelemetryEvent, TelemetryMeta } from '../../shared/types.js';

export type { TelemetryMeta };

export interface FeatureVector {
  [feature: string]: number;
}

export interface DomElementSnapshot {
  selector: string;
  tagName: string;
  id: string;
  className: string;
  type: string;
  name: string;
  text: string;
  role: string;
  href: string;
  isVisible: boolean;
  disabled: boolean;
  featureVector: FeatureVector;
  score: number;
}

export interface ActionBreadcrumb {
  timestamp: string;
  selector: string;
  action: string;
  payload?: string;
  score?: number;
}

export interface ExplorerHooks {
  emitTelemetry: (event: TelemetryEvent) => void;
  emitTargets: (targets: DiscoveredElement[]) => void;
  emitLiveFrame: (base64Jpeg: string) => void;
  emitForensicReport: (report: ForensicCrashReport) => void;
}

/**
 * Run Controller interface for managing the autonomous exploration loop.
 * Provides pause/resume/stop controls for the exploration engine.
 */
export interface RunController {
  waitIfPaused: () => Promise<void>;
  requestStop: () => void;
  isStopRequested: () => boolean;
  getPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
}

import type { AccessibilityFinding, DiscoveredElement, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';

export type BrowserConsoleLevel =
  | 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'notice';

export interface BrowserConsoleMessage {
  timestamp: string;
  level: BrowserConsoleLevel;
  type: string;
  message: string;
  url?: string;
  line?: number;
  column?: number;
  stackTrace?: string;
}

export interface TelemetryGateway {
  emitTelemetry(event: TelemetryEvent): void;
  emitTargets(targets: DiscoveredElement[]): void;
  emitLiveFrame(base64Jpeg: string): void;
  emitLiveFrameBinary?(frameBuffer: Buffer): void;
  emitForensicReport(report: ForensicCrashReport): void;
  emitIncidentReport(report: IncidentReport): void;

  /** Dedicated WCAG channel — kept separate from the generic fault streams. */
  emitAccessibility(finding: AccessibilityFinding): void;

  /** Specialized socket event for dashboard URL bar updates. */
  emitUrlChanged(url: string): void;

  /** Emit browser console message from target page */
  emitBrowserConsole?(message: BrowserConsoleMessage): void;
}


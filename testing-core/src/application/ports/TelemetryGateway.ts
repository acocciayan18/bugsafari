import type { AccessibilityFinding, BrowserConsoleLevel, BrowserConsoleMessage, DiscoveredElement, FindingUpgrade, ForensicCrashReport, IncidentReport, ReproductionVerdict, TelemetryEvent, TimeSyncPayload } from '../../../../shared/types.js';

export type { BrowserConsoleLevel, BrowserConsoleMessage };

export interface TelemetryGateway {
  emitTelemetry(event: TelemetryEvent): void;
  emitTargets(targets: DiscoveredElement[]): void;
  emitLiveFrame(base64Jpeg: string): void;
  emitLiveFrameBinary?(frameBuffer: Buffer): void;
  emitForensicReport(report: ForensicCrashReport): void;
  emitIncidentReport(report: IncidentReport): void;

  /** Dedicated WCAG channel — kept separate from the generic fault streams. */
  emitAccessibility(finding: AccessibilityFinding): void;

  /** Late verdict patching an already-streamed finding with its reproduction result. */
  emitReproductionVerdict?(verdict: ReproductionVerdict): void;

  /** Late patch raising an already-streamed finding's severity/message to a stronger verdict. */
  emitFindingUpgrade?(upgrade: FindingUpgrade): void;

  /** Specialized socket event for dashboard URL bar updates. */
  emitUrlChanged(url: string): void;

  /** Authoritative timebox clock (~1 Hz). The single source of truth the frontend
   *  timer slaves to; bypasses the capped telemetry buffer. */
  emitTimeSync?(payload: TimeSyncPayload): void;

  /** Emit browser console message from target page */
  emitBrowserConsole?(message: BrowserConsoleMessage): void;
}


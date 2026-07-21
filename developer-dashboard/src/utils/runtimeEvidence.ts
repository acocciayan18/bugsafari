// utils/runtimeEvidence.ts
// Per-finding runtime evidence: the console output and failed network requests
// captured around a fault's timestamp. One normalized shape feeds the shared
// <FindingEvidence> section from both the live streams (BrowserConsoleMessage /
// TelemetryEvent) and the saved report rows (ForensicConsoleLog / ForensicNetworkLog).
import type {
  BrowserConsoleMessage,
  ForensicConsoleLog,
  ForensicNetworkLog,
  TelemetryEvent,
} from '../types';

// Fault correlation window: evidence this long BEFORE the fault (lead-up)
// and this long AFTER it (async fallout) is considered related.
const BEFORE_MS = 15_000;
const AFTER_MS = 5_000;

export interface EvidenceConsoleRow {
  timestamp: string;
  level: string;
  message: string;
  stackTrace?: string;
}

export interface EvidenceNetworkRow {
  timestamp: string;
  method: string;
  url: string;
  statusCode?: number;
  message?: string;
}

export interface RuntimeEvidence {
  console: EvidenceConsoleRow[];
  network: EvidenceNetworkRow[];
}

const inWindow = (eventTs: string, faultTs: string): boolean => {
  const event = Date.parse(eventTs);
  const fault = Date.parse(faultTs);
  if (Number.isNaN(event) || Number.isNaN(fault)) return false;
  return event >= fault - BEFORE_MS && event <= fault + AFTER_MS;
};

// Only warnings/errors matter as evidence; info/log noise stays in the Console tab.
const isSignalLevel = (level: string): boolean => level === 'error' || level === 'warning';

const isFailedRequest = (statusCode?: number): boolean =>
  statusCode === undefined || statusCode >= 400;

/** Evidence for a live finding, correlated from the streaming buffers. */
export function correlateLiveEvidence(
  faultTimestamp: string | undefined,
  browserConsole: BrowserConsoleMessage[],
  networkEvents: TelemetryEvent[],
): RuntimeEvidence {
  if (!faultTimestamp) return { console: [], network: [] };
  return {
    console: browserConsole
      .filter((m) => isSignalLevel(m.level) && inWindow(m.timestamp, faultTimestamp))
      .map((m) => ({ timestamp: m.timestamp, level: m.level, message: m.message, stackTrace: m.stackTrace })),
    network: networkEvents
      .filter((e) => isFailedRequest(e.meta?.statusCode) && inWindow(e.timestamp, faultTimestamp))
      .map((e) => ({
        timestamp: e.timestamp,
        method: e.meta?.method ?? 'GET',
        url: e.meta?.url ?? '',
        statusCode: e.meta?.statusCode,
        message: e.meta?.message,
      })),
  };
}

/** Evidence for a saved finding, correlated from the persisted full-log rows. */
export function correlateSavedEvidence(
  faultTimestamp: string | undefined,
  consoleRows: ForensicConsoleLog[],
  networkRows: ForensicNetworkLog[],
): RuntimeEvidence {
  if (!faultTimestamp) return { console: [], network: [] };
  return {
    console: consoleRows
      .filter((r) => isSignalLevel(r.level) && inWindow(r.timestamp, faultTimestamp))
      .map((r) => ({ timestamp: r.timestamp, level: r.level, message: r.message, stackTrace: r.stackTrace })),
    network: networkRows
      .filter((r) => (!r.ok || (r.statusCode ?? 0) >= 400) && inWindow(r.timestamp, faultTimestamp))
      .map((r) => ({ timestamp: r.timestamp, method: r.method, url: r.url, statusCode: r.statusCode, message: r.message })),
  };
}

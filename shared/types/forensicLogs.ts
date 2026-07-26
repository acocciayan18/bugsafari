// ═══════════════════════════════════════════════════════════════
// shared/types/forensicLogs.ts - FULL NETWORK & CONSOLE LOG CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Persisted per-run logs mirroring the live dashboard tabs. Unlike
// forensic_errors (faults only), these capture EVERY request/console
// line so a saved report matches what the operator watched live.

// One observed network request (any status, incl. successful).
export interface NetworkLogEntry {
  timestamp: string;
  method: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  resourceType?: string;
  ok: boolean;
  message?: string;
  /** Consecutive identical rows collapsed (>1 ⇒ repeated request). */
  repeatCount?: number;
}

// A network row is actionable only when it signals a defect: a transport-level
// failure (no status — DNS/offline/refused/timeout/CORS) or an HTTP error (>=400).
// 2xx/3xx successes are noise — never emitted live, persisted, or rendered. Both
// packages share this one predicate so live and saved outputs stay identical.
export function isActionableNetworkStatus(statusCode?: number | null): boolean {
  return statusCode === undefined || statusCode === null || statusCode >= 400;
}

// One console line at any level — structurally the live BrowserConsoleMessage.
export interface ConsoleLogEntry {
  timestamp: string;
  level: 'log' | 'error' | 'warning' | 'info' | 'debug' | 'trace' | 'notice';
  type: string;
  message: string;
  url?: string;
  line?: number;
  column?: number;
  stackTrace?: string;
}

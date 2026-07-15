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

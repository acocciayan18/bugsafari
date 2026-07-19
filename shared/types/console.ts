// ═══════════════════════════════════════════════════════════════
// shared/types/console.ts - BROWSER CONSOLE CONTRACT
// ═══════════════════════════════════════════════════════════════
// The single cross-package shape for a captured target-page console/pageerror
// message. Previously redefined in three places (dashboard types, EngineGateway,
// TelemetryGateway) which risked silent drift; all now import from here.

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
  /** Present on pageerror rows — the console channel alone carries no stack. */
  stackTrace?: string;
}

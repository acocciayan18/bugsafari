// ═══════════════════════════════════════════════════════════════
// shared/types/telemetryPolicy.ts - CENTRAL TELEMETRY FILTER + DEDUP CONTRACT
// ═══════════════════════════════════════════════════════════════
// One policy shared by the backend emit path (SocketTelemetryGateway) and the
// dashboard render, so live, replayed, and saved streams collapse noise the same
// way. Findings and faults are always preserved — only redundant execution-trace
// and repeated lifecycle handshakes are suppressed.

import type { TelemetryEvent } from './telemetry.js';

// ACTION codes emitted on (nearly) every step — high-volume execution trace with
// low standalone value. Hidden from the default log; revealed by verbose mode.
//
// The `auth-*` codes are deliberately NOT listed: target-app login is a handful of
// events per run that an operator must be able to audit by default. Adding one
// here would make the login silent again.
export const VERBOSE_ACTION_CODES: ReadonlySet<string> = new Set([
  'element-selected',
  'dom-elements-parsed',
  'dom-state-hash',
  'system-status',
  'action-executed',
  'curiosity-decision',
  'novelty-reward-triggered',
  'state-revisited',
  'saturated-destination-penalized',
  'network-sabotage',
  // Completion echoes — the same ending is carried authoritatively by engine-stopped.
  'graph-exhausted',
  'boundary-saturation',
]);

// Findings and faults are never suppressed or collapsed — always shown in full.
const PRESERVED_TYPES: ReadonlySet<TelemetryEvent['type']> = new Set(['EXCEPTION', 'BUG', 'NETWORK']);

// Idempotent lifecycle handshakes — one per run is enough (repeat IDLEs are noise).
function isOnceOnly(event: TelemetryEvent): boolean {
  return event.type === 'ACTION' && event.meta?.actionExecuted === 'engine-status';
}

// True for per-step execution-trace lines only a debugger needs.
export function isVerboseTelemetry(event: TelemetryEvent): boolean {
  if (event.type === 'HEURISTIC_SCORE') return true;
  if (event.type !== 'ACTION') return false;
  const code = event.meta?.actionExecuted;
  return code ? VERBOSE_ACTION_CODES.has(code) : false;
}

// Stable identity for consecutive-duplicate collapsing.
export function telemetryDedupeKey(event: TelemetryEvent): string {
  return `${event.type}|${event.meta?.actionExecuted ?? ''}|${event.meta?.message ?? ''}`;
}

export interface TelemetryDeduper {
  accept(event: TelemetryEvent): boolean;
  reset(): void;
}

// Drops back-to-back identical lines and repeat one-shot lifecycle signals while
// never touching findings/faults. Stateful — one instance per stream (per run on
// the backend, per render pass on the client).
export function createTelemetryDeduper(): TelemetryDeduper {
  let lastKey: string | null = null;
  const seenOnceKeys = new Set<string>();
  return {
    accept(event) {
      // A finding/fault always passes and breaks any consecutive-dup run.
      if (PRESERVED_TYPES.has(event.type)) {
        lastKey = null;
        return true;
      }
      const key = telemetryDedupeKey(event);
      if (isOnceOnly(event)) {
        if (seenOnceKeys.has(key)) return false;
        seenOnceKeys.add(key);
        lastKey = key;
        return true;
      }
      if (key === lastKey) return false;
      lastKey = key;
      return true;
    },
    reset() {
      lastKey = null;
      seenOnceKeys.clear();
    },
  };
}

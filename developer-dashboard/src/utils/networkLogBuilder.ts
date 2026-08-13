// utils/networkLogBuilder.ts
// Single source for the saved network log AND the live Network badge count, so the
// two can never diverge. Keeps only a GENUINE observed request (rawNetwork) that
// actually failed (actionable status), deduped by method+url+status into one row
// with a repeatCount — the exact rule the live Network tab and the forensic report use.
import { isActionableNetworkStatus, routeNetworkEvent, NON_TARGET_NETWORK_REASONS } from '../../../shared/types.js';
import type { TelemetryEvent } from '../types';

// The one place both row-builders decide "is this a genuine target-app request worth
// showing" — a raw observed request that failed, minus the engine/browser noise above.
export function isShownNetworkFailure(meta: TelemetryEvent['meta']): boolean {
  if (meta?.rawNetwork !== true || !isActionableNetworkStatus(meta?.statusCode)) return false;
  const statusCode = meta?.statusCode;
  const routed = routeNetworkEvent({
    kind: statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
    statusCode,
    url: meta?.url ?? '',
    resourceType: meta?.resourceType ?? 'xhr',
    failureText: meta?.errorText,
  });
  return !NON_TARGET_NETWORK_REASONS.has(routed.reasonCode);
}

export interface SavedNetworkRow {
  timestamp: string;
  method: string;
  url: string;
  statusCode?: number;
  durationMs?: number;
  ok: boolean;
  errorText?: string;
  repeatCount: number;
}

export function buildSavedNetworkRows(networkEvents: TelemetryEvent[]): SavedNetworkRow[] {
  const map = new Map<string, SavedNetworkRow>();
  for (const e of networkEvents) {
    // Only genuine target-app failures — excludes BugSafari's own NETWORK-channel
    // diagnostics (no rawNetwork) and engine/browser noise (cancelled/asset/harness).
    if (e.type !== 'NETWORK' || !isShownNetworkFailure(e.meta)) continue;
    const method = e.meta?.method ?? 'GET';
    const url = e.meta?.url ?? '';
    const statusCode = e.meta?.statusCode;
    const key = `${method}|${url}|${statusCode ?? ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.repeatCount += 1;
      if (typeof e.meta?.durationMs === 'number') existing.durationMs = e.meta.durationMs;
    } else {
      map.set(key, {
        timestamp: e.timestamp,
        method,
        url,
        statusCode,
        durationMs: e.meta?.durationMs,
        ok: e.meta?.ok === true,
        errorText: e.meta?.errorText,
        repeatCount: 1,
      });
    }
  }
  return [...map.values()];
}

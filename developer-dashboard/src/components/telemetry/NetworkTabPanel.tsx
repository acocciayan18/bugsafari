import type { TelemetryEvent } from '../../types';
import { isShownNetworkFailure } from '../../utils/networkLogBuilder';
import NetworkFailureList, { type NetworkFailureRow } from '../common/NetworkFailureCard';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface NetworkTabPanelProps {
  events: TelemetryEvent[];
}

// A qualifying Network-tab row: a GENUINE observed target-app request (rawNetwork,
// streamed from the engine's recordNetworkLog) that was a failure — HTTP 4xx/5xx or a
// transport-level error (no statusCode). BugSafari findings/diagnostics/scenario
// descriptions ride the same NETWORK channel but are NOT rawNetwork, so they never
// appear here — this tab reflects only real network activity from the application.
export function isActionableNetworkFailure(event: TelemetryEvent): boolean {
  return isShownNetworkFailure(event.meta);
}

// Collapse rows by method+url+status (preserving first-seen order) so a polled endpoint
// is one row with a repeat count. Shared with the tab badge so header count and list match.
export function dedupeNetworkEvents(events: TelemetryEvent[]): { event: TelemetryEvent; count: number }[] {
  const map = new Map<string, { event: TelemetryEvent; count: number }>();
  for (const event of Array.isArray(events) ? events : []) {
    if (!isActionableNetworkFailure(event)) continue;
    const m = event.meta;
    const key = `${m?.method ?? 'GET'}|${m?.url ?? ''}|${m?.statusCode ?? ''}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { event, count: 1 });
  }
  return [...map.values()];
}

// Map a deduped live network event into the shared row shape.
function eventToRow(event: TelemetryEvent, count: number): NetworkFailureRow {
  const meta = event.meta;
  return {
    method: meta?.method || 'GET',
    statusCode: meta?.statusCode,
    url: meta?.url || 'unknown',
    ok: meta?.ok === true,
    count,
    errorText: meta?.errorText || undefined,
    timestamp: event.timestamp,
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: NetworkTabPanel
// ─────────────────────────────────────────────────────────────

export default function NetworkTabPanel({ events = [] }: NetworkTabPanelProps) {
  // Dedup (shared with the tab badge), then cap the rendered rows.
  const rows = dedupeNetworkEvents(events).slice(-50).map(({ event, count }) => eventToRow(event, count));
  return <NetworkFailureList rows={rows} />;
}

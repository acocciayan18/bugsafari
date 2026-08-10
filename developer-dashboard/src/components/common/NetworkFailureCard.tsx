// Shared Network-failure card + list — the ONE renderer used by the live Network
// tab (NetworkTabPanel, fed from TelemetryEvent meta) and the saved Forensic Report
// (fed from ForensicNetworkLog). Both map their source rows into NetworkFailureRow,
// so the live and forensic Network tabs cannot drift in layout, tone or spacing.

import { routeNetworkEvent } from '../../../../shared/types.js';

// Normalized, source-agnostic shape both callers adapt into. Only the fields worth
// showing an operator: method, status/error code, endpoint, error text, count, time.
export interface NetworkFailureRow {
  method: string;
  statusCode?: number;
  url: string;
  ok: boolean;
  count: number;
  resourceType?: string;
  errorText?: string;
  timestamp?: string;
}

export function NetworkFailureCard({ row }: { row: NetworkFailureRow }) {
  const { method, statusCode, url, ok, count, errorText } = row;

  // Tier from the shared routing tree — same call the engine made deciding this was
  // a Network row. A transport failure (no status) is infrastructure, painted amber.
  const routed = routeNetworkEvent({
    kind: statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
    statusCode,
    url,
    resourceType: row.resourceType ?? 'xhr',
    failureText: errorText,
  });
  const isServerError = routed.reasonCode === 'SERVER_ERROR' || routed.reasonCode === 'SOFT_FAIL_BODY';
  const isClientError = !isServerError && routed.tier !== 'INFORMATIONAL';

  const borderColor = isServerError
    ? 'border-(--status-critical-border)'
    : isClientError
      ? 'border-(--status-warning-border)'
      : 'border-(--border-hairline)';
  const bgColor = isServerError
    ? 'bg-(--status-critical-bg)'
    : isClientError
      ? 'bg-(--status-warning-bg)'
      : 'bg-(--surface-panel)';

  return (
    <div className={`border ${borderColor} ${bgColor} rounded-lg overflow-hidden shadow-sm`}>
      <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-(--border-hairline)">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[13px] font-bold text-(--status-critical-fg)">
            {method} {statusCode || 'ERR'}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[13px] font-bold uppercase ${
              ok ? 'bg-(--status-stable-bg) text-(--status-stable-fg)' : 'bg-(--status-critical-bg) text-(--status-critical-fg)'
            }`}
          >
            {ok ? 'OK' : 'Failed'}
          </span>
          {count > 1 && <span className="text-xs text-(--text-secondary)">×{count}</span>}
          <span className="rounded bg-(--surface-inset) px-1.5 py-0.5 text-xs font-semibold uppercase text-(--text-tertiary)">
            {routed.reasonCode.replace(/_/g, ' ').toLowerCase()}
          </span>
        </div>
      </div>

      <div className="px-3 py-2 text-[13px] font-mono text-(--text-secondary) break-all">{url}</div>

      <div className="px-3 py-2 text-xs text-(--text-secondary) border-t border-(--border-hairline) space-y-1">
        <div className="leading-relaxed">{routed.reason}</div>
        {errorText && <div className="font-mono break-all text-(--text-tertiary)">{errorText}</div>}
      </div>
    </div>
  );
}

// Full list — shared header, empty state and card spacing so both tabs match exactly.
export default function NetworkFailureList({
  rows,
  emptyMessage = 'No network failures detected.',
}: {
  rows: NetworkFailureRow[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-(--text-secondary) py-4">
        <div className="text-(--text-secondary)  text-[13px] leading-relaxed">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      <div className="text-(--text-primary) mb-2 font-bold">Network Failures ({rows.length})</div>
      {rows.map((row, idx) => (
        <NetworkFailureCard key={`network-${idx}`} row={row} />
      ))}
    </div>
  );
}

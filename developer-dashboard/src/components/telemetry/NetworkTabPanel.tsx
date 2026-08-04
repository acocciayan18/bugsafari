import type { TelemetryEvent } from '../../types';
import { isActionableNetworkStatus, routeNetworkEvent } from '../../../../shared/types.js';

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
  return event.meta?.rawNetwork === true && isActionableNetworkStatus(event.meta?.statusCode);
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

// One "key: value" header row.
function HeaderList({ title, headers }: { title: string; headers?: Record<string, string> }) {
  const entries = headers ? Object.entries(headers) : [];
  if (entries.length === 0) return null;
  return (
    <div className="mt-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-(--text-tertiary)">{title}</div>
      <div className="mt-0.5 space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="font-mono text-[11px] text-(--text-secondary) break-all">
            <span className="text-(--text-tertiary)">{k}:</span> {v}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: NetworkTabPanel
// ─────────────────────────────────────────────────────────────

export default function NetworkTabPanel({ events = [] }: NetworkTabPanelProps) {
  // Dedup (shared with the tab badge), then cap the rendered rows.
  const deduped = dedupeNetworkEvents(events).slice(-50);

  if (deduped.length === 0) {
    return (
      <div className="text-(--text-secondary) py-4">
        <div className="text-(--text-primary) mb-2 font-bold">Network Failures</div>
        <div className="text-(--text-tertiary) italic text-[13px] leading-relaxed">
          No network failures detected.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-2">
      <div className="text-(--text-primary) mb-2 font-bold">Network Failures ({deduped.length})</div>
      {deduped.map(({ event, count }, idx) => {
        const meta = event.meta;
        const statusCode = meta?.statusCode;
        const url = meta?.url || 'unknown';
        const method = meta?.method || 'GET';
        const errorText = meta?.errorText || '';
        const traceId = meta?.traceId || '';
        const ok = meta?.ok === true;

        // Tier from the shared routing tree — same call the engine made deciding this was
        // a Network row. A transport failure (no status) is infrastructure, painted amber.
        const routed = routeNetworkEvent({
          kind: statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
          statusCode,
          url,
          resourceType: 'xhr',
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
          <div
            key={`network-${idx}`}
            className={`border ${borderColor} ${bgColor} rounded-lg overflow-hidden shadow-sm`}
          >
            <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-(--border-hairline)">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[13px] font-bold text-(--status-critical-fg)">
                  {method} {statusCode || 'ERR'}
                </span>
                {/* Clear success/failure marker (rows here are failures; badge is explicit). */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
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

            {(errorText || traceId) && (
              <div className="px-3 py-2 text-xs text-(--text-secondary) border-t border-(--border-hairline) space-y-1">
                {errorText && <div className="font-mono break-all">{errorText}</div>}
                {traceId && (
                  <div className="font-mono text-[11px]">
                    <span className="text-(--text-tertiary)">trace id:</span> {traceId}
                  </div>
                )}
              </div>
            )}

            {(meta?.responseHeaders || meta?.requestHeaders) && (
              <div className="px-3 py-2 border-t border-(--border-hairline)">
                <HeaderList title="Response headers" headers={meta?.responseHeaders} />
                <HeaderList title="Request headers" headers={meta?.requestHeaders} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

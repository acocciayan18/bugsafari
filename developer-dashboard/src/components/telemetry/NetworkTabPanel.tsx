import type { TelemetryEvent } from '../../types';
import { isActionableNetworkStatus, routeNetworkEvent } from '../../../../shared/types.js';
import ReproductionChecklist from './ReproductionChecklist';
import AiDiagnosticCard from './AiDiagnosticCard';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface NetworkTabPanelProps {
  events: TelemetryEvent[];
}

// A qualifying Network-tab row: HTTP 4xx/5xx, or a transport-level failure
// (DNS/offline/refused/timeout) which carries no statusCode at all. 2xx/3xx
// successes are noise for this tab — they're still preserved in the raw
// networkEvents buffer for saved-session history, just not shown live here.
export function isActionableNetworkFailure(event: TelemetryEvent): boolean {
  return isActionableNetworkStatus(event.meta?.statusCode);
}

// Collapse NETWORK failure events by method+url+status (preserving first-seen
// order) so a polled endpoint is one row with a repeat count. Shared with the
// tab badge so the header count and the list length always match.
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

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: NetworkTabPanel
// ─────────────────────────────────────────────────────────────

export default function NetworkTabPanel({
  events = []
}: NetworkTabPanelProps) {
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
        const message = meta?.message || '';
        const aiDiagnostics = meta?.aiDiagnostics || null;
        const reproductionSteps = meta?.reproductionSteps ?? [];

        // Tier comes from the shared routing tree — the same call the engine made when
        // it decided this was a Network row rather than a finding. A transport failure
        // (no status) is infrastructure, so it no longer paints itself critical red.
        const routed = routeNetworkEvent({
          kind: statusCode === undefined ? 'TRANSPORT_FAILURE' : 'HTTP_RESPONSE',
          statusCode,
          url,
          resourceType: 'xhr',
          failureText: message,
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
        const textColor = 'text-(--status-critical-fg)';

        return (
          <div
            key={`network-${idx}`}
            className={`border ${borderColor} ${bgColor} rounded-lg overflow-hidden shadow-sm`}
          >
            <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-(--border-hairline)">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`font-mono text-[13px] font-bold ${textColor}`}>
                  {method} {statusCode || 'ERR'}
                </span>
                {count > 1 && (
                  <span className="text-xs text-(--text-secondary)">×{count}</span>
                )}
                <span className="rounded bg-(--surface-inset) px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-(--text-tertiary)">
                  {routed.reasonCode.replace(/_/g, ' ').toLowerCase()}
                </span>
              </div>
            </div>
            <div className="px-3 py-2 text-[13px] font-mono text-(--text-secondary) break-all">
              {url}
            </div>
            {(message || aiDiagnostics) && (
              <div className="px-3 py-2 text-xs text-(--text-secondary) border-t border-(--border-hairline)">
                {message}
                <AiDiagnosticCard ai={aiDiagnostics} />
              </div>
            )}
            {reproductionSteps.length > 0 && (
              <div className="px-3 pb-3 border-t border-(--border-hairline)">
                <ReproductionChecklist steps={reproductionSteps} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

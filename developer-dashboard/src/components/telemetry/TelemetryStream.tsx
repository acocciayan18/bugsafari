import { useMemo } from 'react';
import { Pause, Play, Square } from 'lucide-react';

import type { TelemetryEvent } from '../../types';

// (Types are imported above; kept file-local Describe logic only.)

interface TelemetryStreamProps {
  events: readonly TelemetryEvent[];
  isConnected: boolean;
  isTestRunning: boolean;
  isPaused: boolean;
  onPauseResume: () => void;
  onStop: () => void;
}

type Pill = {
  label: string;
  color: string;
};

type DescribeResult = {
  title: string;
  sub: string;
  pill: Pill;
};

export default function TelemetryStream({
  events,
  isConnected,
  isTestRunning,
  isPaused,
  onPauseResume,
  onStop,
}: TelemetryStreamProps) {
  const normalized = useMemo(() => {
    // newest first, but keep stable ordering for same timestamp
    return [...events].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }, [events]);

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-(--border-hairline) bg-(--surface-panel) shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-(--border-hairline) px-3 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-(--surface-invert) text-[13px] font-bold text-(--text-oninvert)">TL</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-(--text-primary)">Telemetry timeline</div>
            <div className="text-[13px] text-(--text-secondary)">Process steps + warnings/errors</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isTestRunning ? (
            <>
              <button
                type="button"
                disabled={!isConnected}
                onClick={onPauseResume}
                className={
                  !isConnected
                    ? 'cursor-not-allowed rounded-lg bg-(--surface-inset) px-3 py-1 font-semibold text-(--text-disabled)'
                    : 'rounded-lg bg-(--surface-invert) px-3 py-1 font-semibold text-(--text-oninvert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active)'
                }
                aria-label={isPaused ? 'Resume exploration' : 'Pause exploration'}
                title={isPaused ? 'Resume exploration' : 'Pause exploration'}
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  {isPaused ? <Play className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : <Pause className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </span>
              </button>

              <button
                type="button"
                disabled={!isConnected}
                onClick={onStop}
                className={
                  !isConnected
                    ? 'cursor-not-allowed rounded-lg bg-(--surface-inset) px-3 py-1 font-semibold text-(--text-disabled)'
                    : 'rounded-lg bg-(--status-critical-fg) px-3 py-1 font-semibold text-(--text-oninvert) hover:opacity-90 active:opacity-80'
                }
                aria-label="Stop exploration"
                title="Stop exploration"
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Square className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  Stop
                </span>
              </button>
            </>
          ) : null}

          <div className="whitespace-nowrap text-[13px] text-(--text-secondary)">{events.length} events</div>
        </div>
      </div>

      <div className="custom-scrollbar max-h-[360px] overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3 sm:px-5">
        {normalized.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-(--border-hairline) bg-(--surface-inset) text-sm font-semibold text-(--text-primary)">
              —
            </div>
            <div className="text-sm font-medium text-(--text-primary)">No telemetry yet</div>
            <div className="max-w-md text-[13px] leading-5 text-(--text-tertiary)">
              Launch a test to start streaming actions, heuristic scores, and exceptions.
            </div>
          </div>
        ) : (
          <ol className="space-y-2">
            {normalized
              // Only show meaningful process steps + warnings/errors.
              // Hide noisy traffic (NETWORK, routine ACTION spam).
              .filter((event) => {
                if (event.type === 'NETWORK') return false;
                const action = event.meta.actionExecuted ?? '';
                // drop frequent low-signal steps
                if (event.type === 'ACTION') {
                  const lowSignal = [
                    'dom-snapshot',
                    'capture-visual',
                    'update-viewport',
                    'poll',
                    'tick',
                  ];
                  if (lowSignal.some((k) => action.toLowerCase().includes(k))) return false;
                }
                return true;
              })
              .map((event, idx) => {
                const { title, sub, pill } = describeEvent(event);

                return (
                  <li
                    key={`${event.timestamp}-${idx}`}
                    className="rounded-xl border border-(--border-hairline) bg-(--surface-inset) px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill.color}`}>
                            {pill.label}
                          </span>
                          <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-(--text-primary)">{title}</div>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-(--text-tertiary)">{sub}</div>
                      </div>
{/* Timestamp display removed for simplified console matching */}
                      {/* <div className="shrink-0 text-[11px] text-[#9CA3AF]">
                        {new Date(event.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div> */}
                    </div>
                  </li>
                );
              })}
          </ol>
        )}
      </div>
    </div>
  );
}

function describeEvent(event: TelemetryEvent): DescribeResult {
  // Determine severity-like pill
  if (event.type === 'EXCEPTION') {
    const msg = (event.meta.message ?? '').toLowerCase();
    const isFatal = msg.includes('fatal') || msg.includes('halt') || event.meta.actionExecuted?.toLowerCase().includes('engine-halted');

    // Extract AI diagnostics for remediation display
    const aiDiagnostics = event.meta.aiDiagnostics;
    let sub = event.meta.actionExecuted ? event.meta.actionExecuted : 'Runtime exception captured';
    
    // If AI diagnostics available, show the suggested fix
    if (aiDiagnostics) {
      const fixPreview = aiDiagnostics.suggestedFix?.slice(0, 100);
      sub = fixPreview ? `${fixPreview}...` : sub;
    }

    return {
      pill: {
        label: isFatal ? 'ERROR' : 'WARNING',
        color: isFatal
          ? 'bg-(--status-critical-bg) text-(--status-critical-fg)'
          : 'bg-(--status-warning-bg) text-(--status-warning-fg)',
      },
      title: event.meta.message ? event.meta.message : 'Exception',
      sub,
    };
  }

  if (event.type === 'HEURISTIC_SCORE') {
    return {
      pill: { label: 'STEP', color: 'bg-(--status-stable-bg) text-(--status-stable-fg)' },
      title: event.meta.message ? event.meta.message : `Score update`,
      sub: event.meta.selector ? `target: ${event.meta.selector}` : event.meta.actionExecuted ?? 'heuristic',
    };
  }

  // ACTION / default
  return {
    pill: { label: 'STEP', color: 'bg-(--status-neutral-bg) text-(--status-neutral-fg)' },
    title: event.meta.message ?? event.meta.actionExecuted ?? event.type,
    sub: event.meta.actionExecuted ? event.meta.actionExecuted : 'engine action',
  };
}

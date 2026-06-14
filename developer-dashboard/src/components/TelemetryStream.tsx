import { useMemo } from 'react';

import type { TelemetryEvent } from '../types';
import { describeEvent, shouldDisplayEvent, sortEventsByTimestamp } from '../utils/telemetryFormatter';

interface TelemetryStreamProps {
  events: readonly TelemetryEvent[];
  isConnected: boolean;
  isTestRunning: boolean;
  isPaused: boolean;
  onPauseResume: () => void;
  onStop: () => void;
}

export default function TelemetryStream({
  events,
  isConnected,
  isTestRunning,
  isPaused,
  onPauseResume,
  onStop,
}: TelemetryStreamProps) {
  // Use utility function for sorting
  const normalized = useMemo(() => {
    return sortEventsByTimestamp([...events]);
  }, [events]);

  // Use utility function for filtering
  const displayable = useMemo(() => {
    return normalized.filter(shouldDisplayEvent);
  }, [normalized]);

  return (
    <div className="w-full max-w-5xl rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#111827] text-xs font-bold text-white">TL</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[#111827]">Telemetry timeline</div>
            <div className="text-xs text-[#6B7280]">Process steps + warnings/errors</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isTestRunning ? (
            <>
              <button
                type="button"
                disabled={!isConnected}
                onClick={onPauseResume}
                className={
                  !isConnected
                    ? 'cursor-not-allowed rounded-lg bg-[#F3F4F6] px-3 py-1 font-semibold text-[#9CA3AF]'
                    : 'rounded-lg bg-[#111827] px-3 py-1 font-semibold text-white hover:bg-[#2F2F2F]'
                }
                aria-label={isPaused ? 'Resume exploration' : 'Pause exploration'}
                title={isPaused ? 'Resume exploration' : 'Pause exploration'}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </button>

              <button
                type="button"
                disabled={!isConnected}
                onClick={onStop}
                className={
                  !isConnected
                    ? 'cursor-not-allowed rounded-lg bg-[#F3F4F6] px-3 py-1 font-semibold text-[#9CA3AF]'
                    : 'rounded-lg bg-[#EF4444] px-3 py-1 font-semibold text-white hover:bg-[#DC2626]'
                }
                aria-label="Stop exploration"
                title="Stop exploration"
              >
                Stop
              </button>
            </>
          ) : null}

          <div className="text-xs text-[#6B7280]">{events.length} events</div>
        </div>
      </div>

      <div className="max-h-[360px] overflow-auto px-3 py-3 sm:px-5">
        {displayable.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-sm font-semibold text-[#111827]">
              —
            </div>
            <div className="text-sm font-medium text-[#374151]">No telemetry yet</div>
            <div className="max-w-md text-xs leading-5 text-[#6B7280]">
              Launch a test to start streaming actions, heuristic scores, and exceptions.
            </div>
          </div>
        ) : (
          <ol className="space-y-2">
            {displayable.map((event, idx) => {
              // Use utility function for event description
              const { title, sub, pill } = describeEvent(event);

              return (
                <li
                  key={`${event.timestamp}-${idx}`}
                  className="rounded-xl border border-[#EEF2F7] bg-[#F9FAFB] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill.color}`}>
                          {pill.label}
                        </span>
                        <div className="truncate text-xs font-semibold text-[#111827]">{title}</div>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-[#6B7280]">{sub}</div>
                    </div>
                    <div className="shrink-0 text-[11px] text-[#9CA3AF]">
                      {new Date(event.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
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

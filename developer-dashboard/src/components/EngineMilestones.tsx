import { useMemo } from 'react';
import type { EngineMilestone } from '../types';


function Checkmark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-5 w-5 place-items-center rounded-full border border-[#111827] bg-white"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M20 6L9 17L4 12"
          stroke="#111827"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="grid h-5 w-5 place-items-center rounded-full border border-[#111827] bg-white"
    >
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#111827] border-t-transparent" />
    </span>
  );
}

export default function EngineMilestones({
  milestones,
}: {
  milestones: readonly EngineMilestone[];
}) {
  const normalized = useMemo(() => milestones, [milestones]);


  return (
    <div className="flex min-h-105 flex-col overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
        Live Safari Timeline
      </div>

      <div className="flex-1 overflow-auto bg-white px-4 py-4">
        {normalized.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] text-sm font-semibold text-[#111827]">
              ST
            </div>
            <div className="text-sm font-medium text-[#374151]">Waiting for milestones</div>
            <div className="max-w-md text-xs leading-5 text-[#6B7280]">
              Start a Safari run to see high-level engine lifecycle steps.
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {normalized.map((m, idx) => {
              const isError = m.status === 'error';
              const isActive = m.status === 'active';
              const isDone = m.status === 'done';

              const border = isError ? 'border-rose-200' : 'border-[#EEF2F7]';
              const bg = isError ? 'bg-rose-50' : 'bg-[#F9FAFB]';
              const titleColor = isError ? 'text-rose-900' : 'text-[#111827]';
              const subColor = isError ? 'text-rose-800' : 'text-[#6B7280]';

              return (
                <li key={`${m.phase}-${m.timestamp}-${idx}`} className={`rounded-xl border ${border} ${bg} px-3 py-2`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {isError ? (
                        <span className="grid h-5 w-5 place-items-center rounded-full border border-rose-400 bg-white">
                          <span className="text-[11px] font-black text-rose-700">!</span>
                        </span>
                      ) : isActive ? (
                        <Spinner />
                      ) : isDone ? (
                        <Checkmark />
                      ) : (
                        <span className="grid h-5 w-5 place-items-center rounded-full border border-[#D1D5DB] bg-white" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-xs font-semibold ${titleColor}`}>{m.title}</div>
                      <div className={`mt-1 text-[11px] ${subColor}`}>
                        {new Date(m.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      {m.message ? (
                        <div className={`mt-2 wrap-break-word text-[11px] font-medium ${isError ? 'text-rose-800' : 'text-[#6B7280]'}`}>
                          {m.message}
                        </div>
                      ) : null}
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


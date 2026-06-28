import { Fragment, useMemo, useState } from 'react';
import type { SessionHistoryEntry } from '../../types';

interface SessionHistoryTableProps {
  sessions: SessionHistoryEntry[];
}

export default function SessionHistoryTable({ sessions }: SessionHistoryTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rows = useMemo(() => sessions, [sessions]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
        Session History
      </div>
      <div className="max-h-[280px] overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-500">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Findings</th>
              <th className="px-3 py-2">Actions</th>
              <th className="px-3 py-2">Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-slate-400" colSpan={5}>No historical sessions yet.</td>
              </tr>
            ) : (
              rows.map((session) => {
                const isExpanded = expandedId === session.id;
                return (
                  <Fragment key={session.id}>
                    <tr
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => setExpandedId(isExpanded ? null : session.id)}
                    >
                      <td className="px-3 py-2">{session.status}{session.savedManually ? ' • saved' : ''}</td>
                      <td className="max-w-[260px] truncate px-3 py-2">{session.targetUrl}</td>
                      <td className="px-3 py-2">{session.findingCount}</td>
                      <td className="px-3 py-2">{session.actionTraceCount}</td>
                      <td className="px-3 py-2">{new Date(session.startedAt).toLocaleString()}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-slate-100 bg-slate-50">
                        <td className="px-3 py-2 text-slate-700" colSpan={5}>
                          <div>Brain snapshots: {session.brainSnapshots}</div>
                          <div>Finished: {session.finishedAt ? new Date(session.finishedAt).toLocaleString() : 'still running'}</div>
                          {session.endedReason ? <div>Reason: {session.endedReason}</div> : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

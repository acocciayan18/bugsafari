// Side-by-side comparison of saved safari sessions.
// Pulls the full forensic report per selected id so the comparison covers the
// persisted truth (defects, routes, runtime) rather than the trimmed list row.

import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { X, TriangleAlert } from 'lucide-react';
import { useHistoryStore } from '../../stores/history/historyStore';
import type { ForensicReportResponse } from '../../types';

interface SessionComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionIds: string[];
}

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

// Highest value across the row wins the emphasis, so outliers are visible at a glance.
function isPeak(values: number[], value: number): boolean {
  const max = Math.max(...values);
  return max > 0 && value === max && values.filter((v) => v === max).length < values.length;
}

interface MetricRow {
  label: string;
  values: number[];
  render: (value: number) => string;
  /** Higher is worse — peak cell is flagged critical instead of neutral. */
  peakIsBad?: boolean;
}

export default function SessionComparisonModal({ isOpen, onClose, sessionIds }: SessionComparisonModalProps) {
  const [reports, setReports] = useState<ForensicReportResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = sessionIds.join(',');

  useEffect(() => {
    if (!isOpen || sessionIds.length === 0) return;
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    const loadReport = useHistoryStore.getState().loadReport;
    Promise.all(sessionIds.map((id) => loadReport(id)))
      .then((loaded) => {
        if (!cancelled) setReports(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the selected sessions.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, key]);

  const metrics: MetricRow[] = reports.length === 0 ? [] : [
    { label: 'Defects found', values: reports.map((r) => r.findings?.totalBugsFound ?? 0), render: String, peakIsBad: true },
    { label: 'Errors logged', values: reports.map((r) => r.errorLogs?.totalErrors ?? 0), render: String, peakIsBad: true },
    { label: 'Risk score', values: reports.map((r) => r.riskScore ?? 0), render: (v) => v.toFixed(0), peakIsBad: true },
    { label: 'Actions executed', values: reports.map((r) => r.metrics?.totalActions ?? 0), render: String },
    { label: 'Pages visited', values: reports.map((r) => r.pagesVisited ?? r.visitedRoutes?.length ?? 0), render: String },
    { label: 'Coverage', values: reports.map((r) => r.coverage ?? 0), render: (v) => `${v.toFixed(0)}%` },
    { label: 'Runtime', values: reports.map((r) => r.duration ?? 0), render: formatDuration },
  ];

  // Union of every bug category across the compared runs, so a category present
  // in only one session still gets a row (showing 0 for the others).
  const categories = Array.from(
    new Set(reports.flatMap((r) => Object.keys(r.findings?.bugsByCategory ?? {})))
  ).sort();

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="compare-modal-title" maxWidthClassName="max-w-6xl">
      <div className="flex items-center justify-between border-b border-(--border-hairline) px-4 py-3">
        <h3 id="compare-modal-title" className="text-sm font-semibold text-(--text-primary)">
          Compare Sessions ({sessionIds.length})
        </h3>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-(--text-secondary) hover:bg-(--surface-hover) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto p-4">
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-(--border-hairline) border-t-(--text-secondary)" />
            <span className="text-sm text-(--text-secondary)">Loading sessions…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <TriangleAlert className="h-10 w-10 text-(--status-critical-fg)" aria-hidden="true" />
            <span className="text-sm font-medium text-(--status-critical-fg)">{error}</span>
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="w-40 border-b border-(--border-hairline) px-3 py-2 text-left font-semibold text-(--text-secondary)">
                  Metric
                </th>
                {reports.map((report, index) => (
                  <th key={sessionIds[index]} className="border-b border-(--border-hairline) px-3 py-2 text-left align-top">
                    <div className="font-semibold text-(--text-primary) break-all">{report.url}</div>
                    <div className="mt-1 font-normal text-(--text-secondary)">{formatDateTime(report.date)}</div>
                    <div className="mt-1 font-normal text-(--text-tertiary)">{report.status}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((row) => (
                <tr key={row.label}>
                  <td className="border-b border-(--border-hairline) px-3 py-2 font-medium text-(--text-secondary)">
                    {row.label}
                  </td>
                  {row.values.map((value, index) => (
                    <td
                      key={sessionIds[index]}
                      className={`border-b border-(--border-hairline) px-3 py-2 font-mono ${
                        isPeak(row.values, value)
                          ? row.peakIsBad ? 'text-(--status-critical-fg) font-bold' : 'text-(--status-stable-fg) font-bold'
                          : 'text-(--text-primary)'
                      }`}
                    >
                      {row.render(value)}
                    </td>
                  ))}
                </tr>
              ))}

              {categories.length > 0 && (
                <tr>
                  <td colSpan={reports.length + 1} className="px-3 pt-5 pb-2 text-[11px] font-bold uppercase tracking-wider text-(--text-tertiary)">
                    Defects by category
                  </td>
                </tr>
              )}
              {categories.map((category) => {
                const values = reports.map((r) => r.findings?.bugsByCategory?.[category] ?? 0);
                return (
                  <tr key={category}>
                    <td className="border-b border-(--border-hairline) px-3 py-2 font-medium text-(--text-secondary)">{category}</td>
                    {values.map((value, index) => (
                      <td
                        key={sessionIds[index]}
                        className={`border-b border-(--border-hairline) px-3 py-2 font-mono ${
                          isPeak(values, value) ? 'text-(--status-critical-fg) font-bold' : 'text-(--text-primary)'
                        }`}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                );
              })}

              <tr>
                <td colSpan={reports.length + 1} className="px-3 pt-5 pb-2 text-[11px] font-bold uppercase tracking-wider text-(--text-tertiary)">
                  URLs visited
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top font-medium text-(--text-secondary)">Routes</td>
                {reports.map((report, index) => {
                  const routes = report.visitedRoutes ?? [];
                  return (
                    <td key={sessionIds[index]} className="px-3 py-2 align-top">
                      {routes.length === 0 ? (
                        <span className="text-(--text-tertiary)">No routes recorded</span>
                      ) : (
                        <ul className="space-y-1">
                          {routes.map((route) => (
                            <li key={route} className="font-mono text-[12px] text-(--text-primary) break-all">{route}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end border-t border-(--border-hairline) px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

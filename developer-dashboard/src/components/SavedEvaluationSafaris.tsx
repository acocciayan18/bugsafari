// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';

export interface EvaluationSafari {
  id: string;
  targetUrl: string;
  date: string;
  steps: number;
  coverage: number;
  severity: 'CRITICAL' | 'HIGH' | 'CLEAR';
  severityCount: number;
  isExpanded?: boolean;
}

interface SavedEvaluationSafarisProps {
  evaluations?: EvaluationSafari[];
  totalCount?: number;
  onSaveSession?: (url: string) => void;
}

const mockEvaluations: EvaluationSafari[] = [
  {
    id: 'SAFARI-892',
    targetUrl: 'https://staging.alpha-shop.io',
    date: 'MAY 16, 2026',
    steps: 40,
    coverage: 84,
    severity: 'HIGH',
    severityCount: 2,
    isExpanded: false,
  },
  {
    id: 'SAFARI-891',
    targetUrl: 'https://beta.service-core.io',
    date: 'MAY 15, 2026',
    steps: 127,
    coverage: 92,
    severity: 'CRITICAL',
    severityCount: 1,
    isExpanded: true,
  },
  {
    id: 'SAFARI-890',
    targetUrl: 'https://prod.portal-network.net',
    date: 'MAY 14, 2026',
    steps: 63,
    coverage: 78,
    severity: 'CLEAR',
    severityCount: 0,
    isExpanded: false,
  },
];

type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'CLEAR';

const ARROW = '\u203A';

export default function SavedEvaluationSafaris({
  evaluations = mockEvaluations,
  totalCount = 214,
}: SavedEvaluationSafarisProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>('ALL');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const filteredEvaluations = useMemo(() => {
    return evaluations.filter((evalItem) => {
      const matchesSearch =
        searchQuery === '' ||
        evalItem.targetUrl.toLowerCase().includes(searchQuery.toLowerCase()) ||
        evalItem.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter =
        activeFilter === 'ALL' ||
        (activeFilter === 'CRITICAL' && evalItem.severity === 'CRITICAL') ||
        (activeFilter === 'HIGH' && evalItem.severity === 'HIGH') ||
        (activeFilter === 'CLEAR' && evalItem.severity === 'CLEAR');
      return matchesSearch && matchesFilter;
    });
  }, [evaluations, searchQuery, activeFilter]);

  // Paginate filtered results
  const paginatedEvaluations = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredEvaluations.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [filteredEvaluations, currentPage]);

  const totalPages = Math.ceil(filteredEvaluations.length / ITEMS_PER_PAGE);
  const showingStart = filteredEvaluations.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(currentPage * ITEMS_PER_PAGE, filteredEvaluations.length);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const progressSegments = [0, 1, 2, 3, 4];

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-slate-900">
            BUGSAFARI
          </span>
          <span className="mx-3 text-slate-400">/</span>
          <span className="text-sm font-semibold text-slate-600">
            AUTONOMOUS TESTING ENGINE
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.82a6.004 6.004 0 00-11.714 0c-.41.405-.714 1.007-.714 1.694v.783c0 2.633 2.146 4.77 4.786 4.77h4.285c2.64 0 4.786-2.137 4.786-4.77v-.783c0-.687-.304-1.289-.714-1.694zM9 17.25h.008v.75H9v-.75z" />
            </svg>
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="m-6 mb-0 flex-1 overflow-auto rounded-md border border-slate-300 bg-slate-50">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              SAVED EVALUATION SAFARIS
            </h2>
            <div className="flex items-center gap-6">
              <div className="relative">
                <div className="flex h-10 w-72 items-center rounded-md bg-white px-3 py-2 shadow-sm">
                  <svg className="mr-2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search URLs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-white p-1">
                {(['ALL', 'CRITICAL', 'HIGH', 'CLEAR'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                      activeFilter === filter
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

<div className="divide-y divide-slate-200">
          {paginatedEvaluations.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No evaluations found matching your criteria.
            </div>
          ) : (
            paginatedEvaluations.map((evalItem) => {
              const isExpanded = expandedIds.has(evalItem.id);
              return (
                <div key={evalItem.id}>
                  <div
                    className="cursor-pointer transition-colors hover:bg-slate-100 bg-white"
                    onClick={() => toggleExpand(evalItem.id)}
                  >
                    <div className="flex items-center justify-between px-6 py-4">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-900">
                          {evalItem.targetUrl}
                        </div>
                        <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                          <span>ID: {evalItem.id}</span>
                          <span>•</span>
                          <span>{evalItem.date}</span>
                          <span>•</span>
                          <span>
                            {evalItem.steps} steps, {evalItem.coverage}% Coverage
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-6 items-center rounded border px-2 text-xs font-medium ${
                            evalItem.severity === 'CRITICAL'
                              ? 'border-red-400 text-red-600'
                              : evalItem.severity === 'HIGH'
                              ? 'border-yellow-400 text-yellow-600'
                              : 'border-green-400 text-green-600'
                          }`}
                        >
                          {evalItem.severityCount} {evalItem.severity}
                        </div>
                        <div className="flex h-6 w-6 items-center justify-center">
                          <svg
                            className={`h-4 w-4 text-slate-400 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-200 bg-slate-50 px-6 pb-6">
                        <div className="flex gap-6 pt-4">
                          <div className="flex-1">
                            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              STEPS TO REPRODUCE
                            </div>
                            <div className="rounded-lg border border-slate-300 bg-slate-900 p-4 font-mono text-xs text-slate-300">
                              <div>{ARROW} Navigate to {evalItem.targetUrl}</div>
                              <div>{ARROW} Click on login button</div>
                              <div>{ARROW} Enter malicious payload in search field</div>
                              <div>{ARROW} Submit form</div>
                              <div>{ARROW} Observe SQL injection response</div>
                            </div>
                          </div>

                          <div className="flex-1 border-l border-slate-300 pl-6">
                            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              AI SUGGESTED FIX
                            </div>
                            <div className="space-y-3 text-xs text-slate-600">
                              <p>
                                <strong>SQL Injection Vulnerability Detected:</strong> The
                                application does not properly sanitize user input in the
                                search field, allowing malicious SQL commands to be executed
                                directly against the database.
                              </p>
                              <blockquote className="border-l-2 border-slate-900 pl-3 italic text-slate-700">
                                Use parameterized queries (prepared statements) for all
                                database operations involving user input. Implement
                                input validation and output encoding.
                              </blockquote>
                              <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                                APPLY PATCH MANIFEST
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
          <div className="flex items-center">
            <span className="font-mono text-xs text-slate-500">
              SHOWING {showingStart}-{showingEnd} OF {totalCount} SAFARIS
            </span>
          </div>
          <div className="flex h-8 gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ‹
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ›
            </button>
          </div>
        </div>
      </main>

      <footer className="mb-6 px-6">
        <div className="mb-4 flex h-2 gap-1 rounded-full">
          {progressSegments.map((idx) => (
            <div
              key={idx}
              className={`h-full flex-1 rounded-full ${
                idx === 1 ? 'bg-slate-700' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>
        <div className="text-center">
          <span className="font-mono text-xs text-slate-400">
            END OF FORENSIC RECORD MANIFEST - V.8.2.19
          </span>
        </div>
      </footer>
    </div>
  );
}

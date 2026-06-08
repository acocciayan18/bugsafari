// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

// Types matching the saved safari document from backend
export interface SafariMetrics {
  totalActions: number;
  totalBugsFound: number;
  bugsByCategory: Record<string, number>;
}

export interface CaughtBug {
  bugId: string;
  type: string;
  message: string;
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: string;
}

export interface ForensicTrace {
  finalBreadcrumbSteps: string[];
  caughtBugs: CaughtBug[];
}

export interface SavedSafariDocument {
  _id: string;
  userId: string;
  targetUrl: string;
  executionDate: string;
  timeElapsed: number;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED';
  metrics: SafariMetrics;
  forensicTrace: ForensicTrace;
}

export interface EvaluationSafari {
  id: string;
  targetUrl: string;
  date: string;
  steps: number;
  coverage: number;
  severity: 'CRITICAL' | 'HIGH' | 'CLEAR';
  severityCount: number;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED';
  timeElapsed: number;
  bugsByCategory: Record<string, number>;
  forensicTrace: ForensicTrace;
  isExpanded?: boolean;
}

// Helper to determine severity from bug count
function determineSeverity(bugCount: number): 'CRITICAL' | 'HIGH' | 'CLEAR' {
  if (bugCount >= 3) return 'CRITICAL';
  if (bugCount >= 1) return 'HIGH';
  return 'CLEAR';
}

// Helper to format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).toUpperCase();
}

// Helper to calculate mock coverage percentage
function calculateCoverage(actions: number): number {
  return Math.min(100, Math.floor(60 + (actions / 50) * 40));
}

// Transform API response to evaluation format
function transformToEvaluations(docs: SavedSafariDocument[]): EvaluationSafari[] {
  return docs.map((doc) => ({
    id: doc._id,
    targetUrl: doc.targetUrl,
    date: formatDate(doc.executionDate),
    steps: doc.metrics.totalActions,
    coverage: calculateCoverage(doc.metrics.totalActions),
    severity: determineSeverity(doc.metrics.totalBugsFound),
    severityCount: doc.metrics.totalBugsFound,
    status: doc.status,
    timeElapsed: doc.timeElapsed,
    bugsByCategory: doc.metrics.bugsByCategory,
    forensicTrace: doc.forensicTrace,
    isExpanded: false,
  }));
}

type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'CLEAR';

const ARROW = '\u203A';

export default function SavedEvaluationSafaris() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>('ALL');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  // Fetch from API on mount
  const [safariData, setSafariData] = useState<EvaluationSafari[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { token } = useAuth();

useEffect(() => {
    async function fetchHistory() {
      try {
        console.log('[SavedEvaluations] Starting fetch with token:', token ? 'token present' : 'NO TOKEN');
        
        const response = await fetch(`${API_BASE_URL}/api/history`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        console.log('[SavedEvaluations] Response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[SavedEvaluations] Error response:', errorText);
          throw new Error(`Failed to fetch history: ${response.status}`);
        }

        const data: SavedSafariDocument[] = await response.json();
        console.log('[SavedEvaluations] Raw API response count:', data?.length ?? 0);
        
        if (!data || data.length === 0) {
          console.log('[SavedEvaluations] No history found for this user - showing empty state');
        }
        
        const transformed = transformToEvaluations(data || []);
        console.log('[SavedEvaluations] Transformed safaris:', transformed.length);
        setSafariData(transformed);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Unknown error');
        console.error('[SavedEvaluations] Fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    }

    if (token) {
      fetchHistory();
    } else {
      console.log('[SavedEvaluations] No token, user not authenticated');
      setIsLoading(false);
    }
  }, [token]);

// Use only API data (fetched from database)
  const displayEvaluations = safariData;
  const displayTotalCount = safariData.length;

  const filteredEvaluations = useMemo(() => {
    return displayEvaluations.filter((evalItem) => {
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
  }, [displayEvaluations, searchQuery, activeFilter]);

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
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600"></div>
              <span className="text-sm text-slate-500">Loading history...</span>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <svg className="h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-medium text-red-600">Failed to load history</span>
              <span className="text-xs text-slate-500">{fetchError}</span>
              <button 
                onClick={() => window.location.reload()}
                className="mt-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Try Again
              </button>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <svg className="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-sm text-slate-600 font-medium">Please log in to view history</span>
              <span className="text-xs text-slate-500">Log in or sign up to access your saved evaluations</span>
              <button 
                onClick={() => window.location.href = '/login'}
                className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-700"
              >
                Go to Login
              </button>
            </div>
          ) : paginatedEvaluations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <svg className="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span className="text-sm text-slate-600 font-medium">No evaluation history yet</span>
              <span className="text-xs text-slate-500">Run your first autonomous test and save it to see results here</span>
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
SHOWING {showingStart}-{showingEnd} OF {displayTotalCount} SAFARIS
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

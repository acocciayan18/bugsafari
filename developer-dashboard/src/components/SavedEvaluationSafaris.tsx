// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { SessionHistoryEntry } from '../types';
import { ReproducibleSteps } from './ReproducibleSteps';
import { CoverageDisplay } from './CoverageProgressBar';
import { RowActionMenu } from './RowActionMenu';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { deleteRecord as deleteSafariRecord, exportRecord, fetchSessionHistory } from '../services/historyService';
import { toast } from 'sonner';

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

// Helper to format execution time (handles both duration ms and timestamps)
function formatExecutionTime(timeValue: number): string {
  if (!timeValue) return 'N/A';
  
  // If value is very large (> 1 billion), it's likely a Unix timestamp
  if (timeValue > 1_000_000_000) {
    const date = new Date(timeValue);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  
  // Otherwise treat as duration in milliseconds
  const seconds = Math.round(timeValue / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
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
  return docs.map((doc) => {
    const metrics = doc.metrics ?? { totalActions: 0, totalBugsFound: 0, bugsByCategory: {} };
    return {
      id: doc._id,
      targetUrl: doc.targetUrl,
      date: formatDate(doc.executionDate),
      steps: metrics.totalActions,
      coverage: calculateCoverage(metrics.totalActions),
      severity: determineSeverity(metrics.totalBugsFound),
      severityCount: metrics.totalBugsFound,
      status: doc.status,
      timeElapsed: doc.timeElapsed,
      bugsByCategory: metrics.bugsByCategory,
      forensicTrace: doc.forensicTrace ?? { finalBreadcrumbSteps: [], caughtBugs: [] },
      isExpanded: false,
    };
  });
}

function mapSessionStatus(s: SessionHistoryEntry['status']): EvaluationSafari['status'] {
  if (s === 'Completed') return 'COMPLETED';
  if (s === 'Crashed') return 'CRASHED';
  return 'HALTED';
}

function transformSessionsToEvaluations(sessions: SessionHistoryEntry[]): EvaluationSafari[] {
  return sessions.map((session) => ({
    id: session.id,
    targetUrl: session.targetUrl,
    date: formatDate(session.startedAt),
    steps: session.actionTraceCount,
    coverage: session.coveragePercentage ?? calculateCoverage(session.actionTraceCount),
    severity: determineSeverity(session.findingCount),
    severityCount: session.findingCount,
    status: mapSessionStatus(session.status),
    timeElapsed: session.runtimeMs ?? 0,
    bugsByCategory: {},
    forensicTrace: { finalBreadcrumbSteps: [], caughtBugs: [] },
    isExpanded: false,
  }));
}

type SeverityFilter = 'ALL' | 'CRITICAL' | 'HIGH' | 'CLEAR';

// Sort types
type SortField = 'date' | 'coverage' | 'severity' | 'status';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Sort priority maps
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 3, HIGH: 2, CLEAR: 1 };
const STATUS_ORDER: Record<string, number> = { COMPLETED: 3, CRASHED: 2, HALTED: 1 };

const ARROW = '\u203A';

// Action type icons for human-readable display
const ACTION_ICONS: Record<string, string> = {
  CLICK: '🔍',
  INPUT: '⌨️',
  HOVER: '👆',
  NAVIGATION: '🌍',
};

// Parse step string into structured object for display
interface ParsedStep {
  stepNumber: number;
  actionType: string;
  actionIcon: string;
  selector: string;
  url: string;
  payload?: string;
}

function parseStepString(stepStr: string): ParsedStep | null {
  // Format: "Step N: ACTION selector at URL with payload X"
  const match = stepStr.match(/Step (\d+): (\w+)\s+(.+?)\s+at\s+(.+?)(?:\s+with\s+payload\s+"(.+)")?$/i);
  if (!match) return null;
  const [, stepNum, action, selector, url, payload] = match;
  return {
    stepNumber: parseInt(stepNum, 10),
    actionType: action.toUpperCase(),
    actionIcon: ACTION_ICONS[action.toUpperCase()] || '•',
    selector: selector.trim(),
    url: url.trim(),
    payload: payload?.trim(),
  };
}

// Human-readable step row component
function StepRow({ step, stepStr }: { step?: ParsedStep | null; stepStr: string }) {
  if (!step) {
    // Fallback: show raw step if parsing failed
    return <div className="font-mono text-xs text-slate-400">{stepStr}</div>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="text-sm">{step.actionIcon}</span>
      <span className="font-semibold text-blue-400">{step.actionType}</span>
      <span className="text-slate-500">on</span>
      <span className="font-mono text-yellow-300">{step.selector}</span>
      {step.payload && (
        <>
          <span className="text-slate-500">with</span>
          <span className="font-mono text-red-300 max-w-[180px] truncate" title={step.payload}>
            {step.payload.length > 40 ? step.payload.slice(0, 40) + '...' : step.payload}
          </span>
        </>
      )}
    </div>
  );
}

export default function SavedEvaluationSafaris() {
const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>('ALL');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'date', direction: 'desc' });
const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

// Bulk delete dialog state (for multi-delete)
  const [bulkDeleteDialogState, setBulkDeleteDialogState] = useState<{
    isOpen: boolean;
    count: number;
    isDeleting: boolean;
  }>({
    isOpen: false,
    count: 0,
    isDeleting: false,
  });

  // Delete dialog state
  const [deleteDialogState, setDeleteDialogState] = useState<{
    isOpen: boolean;
    recordId: string | null;
    targetUrl: string;
    isDeleting: boolean;
  }>({
    isOpen: false,
    recordId: null,
    targetUrl: '',
    isDeleting: false,
  });

  // Fetch from API on mount
  const [safariData, setSafariData] = useState<EvaluationSafari[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

const { token, isAuthLoading } = useAuth();

  // Fetch from API on mount - with sanity barrier to prevent race condition
  useEffect(() => {
    // 🚀 CRITICAL: Intercept transitional mounting frames to halt requests with uninitialized tokens
    if (!token || isAuthLoading) {
      return;
    }

    fetchHistory();
  }, [token, isAuthLoading]);

  // Refetch function exposed for manual refresh
  const fetchHistory = async (showLoading = true) => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    if (showLoading) setIsLoading(true);
    setFetchError(null);
    try {
      const sessions = await fetchSessionHistory();
      console.log('[SavedEvaluations] Sessions count:', sessions.length);
      setSafariData(transformSessionsToEvaluations(sessions));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFetchError(msg);
      console.error('[SavedEvaluations] Fetch error:', err);
      toast.error('Failed to load history. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

// Expose refresh function for button
  const handleRefresh = () => {
    fetchHistory(true);
  };

  // Handle delete record with confirmation
  const handleDeleteClick = (recordId: string, targetUrl: string) => {
    console.log('[SavedEvaluations] Delete requested for:', recordId);
    setDeleteDialogState({
      isOpen: true,
      recordId,
      targetUrl,
      isDeleting: false,
    });
  };

  // Confirm delete action
  const handleDeleteConfirm = async () => {
    const { recordId } = deleteDialogState;
    if (!recordId) return;

    setDeleteDialogState(prev => ({ ...prev, isDeleting: true }));

    try {
      await deleteSafariRecord(recordId);
      console.log('[SavedEvaluations] Record deleted successfully:', recordId);
      
      // Show success toast
      toast.success('Record deleted successfully');
      
      // Close dialog and refresh
      setDeleteDialogState({
        isOpen: false,
        recordId: null,
        targetUrl: '',
        isDeleting: false,
      });
      
      // Refresh the list
      fetchHistory(false);
    } catch (err) {
      console.error('[SavedEvaluations] Delete error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete record');
      
      setDeleteDialogState(prev => ({ ...prev, isDeleting: false }));
    }
  };

  // Close delete dialog
  const handleDeleteClose = () => {
    setDeleteDialogState({
      isOpen: false,
      recordId: null,
      targetUrl: '',
      isDeleting: false,
    });
  };

// Handle export record
  const handleExportRecord = async (recordId: string) => {
    console.log('[SavedEvaluations] Export requested for:', recordId);
    try {
      await exportRecord(recordId);
      toast.success('Record exported successfully');
    } catch (err) {
      console.error('[SavedEvaluations] Export error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to export record');
    }
  };

  // Handle view report (navigate to forensic report page)
  const handleViewReport = (recordId: string) => {
    window.location.href = `/forensic-report/${recordId}`;
  };

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

  // Sort evaluations
  const sortedEvaluations = useMemo(() => {
    const sorted = [...filteredEvaluations];
    const { field, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (field) {
        case 'date':
          aVal = a.date;
          bVal = b.date;
          return multiplier * aVal.localeCompare(bVal);
        case 'coverage':
          aVal = a.coverage;
          bVal = b.coverage;
          return multiplier * (aVal - bVal);
        case 'severity':
          aVal = SEVERITY_ORDER[a.severity] ?? 0;
          bVal = SEVERITY_ORDER[b.severity] ?? 0;
          return multiplier * (aVal - bVal);
        case 'status':
          aVal = STATUS_ORDER[a.status] ?? 0;
          bVal = STATUS_ORDER[b.status] ?? 0;
          return multiplier * (aVal - bVal);
        default:
          return 0;
      }
    });

    return sorted;
  }, [filteredEvaluations, sortConfig]);

// Paginate sorted and filtered results
  const paginatedEvaluations = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedEvaluations.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [sortedEvaluations, currentPage]);

const totalPages = Math.ceil(sortedEvaluations.length / ITEMS_PER_PAGE);
  const showingStart = sortedEvaluations.length > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0;
  const showingEnd = Math.min(currentPage * ITEMS_PER_PAGE, sortedEvaluations.length);

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

  // Selection helper functions (after paginatedEvaluations is defined)
  const toggleRowSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    const visibleIds = paginatedEvaluations.map((item) => item.id);
    setSelectedIds(new Set(visibleIds));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const selectedCount = selectedIds.size;
  const isAllSelected = paginatedEvaluations.length > 0 && paginatedEvaluations.every((item) => selectedIds.has(item.id));

  // Bulk action handlers
  const handleBulkDelete = () => {
    console.log('[SavedEvaluations] Bulk delete requested for:', selectedCount, 'items');
    setBulkDeleteDialogState({
      isOpen: true,
      count: selectedCount,
      isDeleting: false,
    });
  };

  const handleBulkDeleteConfirm = async () => {
    setBulkDeleteDialogState(prev => ({ ...prev, isDeleting: true }));

    const idsToDelete = Array.from(selectedIds);
    let deletedCount = 0;
    let failedCount = 0;

    for (const recordId of idsToDelete) {
      try {
        await deleteSafariRecord(recordId);
        deletedCount++;
      } catch (err) {
        console.error('[SavedEvaluations] Failed to delete record:', recordId, err);
        failedCount++;
      }
    }

    if (deletedCount > 0) {
      toast.success(`Deleted ${deletedCount} record${deletedCount > 1 ? 's' : ''}`);
    }
    if (failedCount > 0) {
      toast.error(`Failed to delete ${failedCount} record${failedCount > 1 ? 's' : ''}`);
    }

    setBulkDeleteDialogState({
      isOpen: false,
      count: 0,
      isDeleting: false,
    });
    deselectAll();
    fetchHistory(false);
  };

  const handleBulkDeleteClose = () => {
    setBulkDeleteDialogState({
      isOpen: false,
      count: 0,
      isDeleting: false,
    });
  };

  const handleBulkExport = async () => {
    console.log('[SavedEvaluations] Bulk export requested for:', selectedCount, 'items');
    const idsToExport = Array.from(selectedIds);
    let exportedCount = 0;
    let failedCount = 0;

    for (const recordId of idsToExport) {
      try {
        await exportRecord(recordId);
        exportedCount++;
      } catch (err) {
        console.error('[SavedEvaluations] Failed to export record:', recordId, err);
        failedCount++;
      }
    }

    if (exportedCount > 0) {
      toast.success(`Exported ${exportedCount} record${exportedCount > 1 ? 's' : ''}`);
    }
    if (failedCount > 0) {
      toast.error(`Failed to export ${failedCount} record${failedCount > 1 ? 's' : ''}`);
    }
  };

  const handleBulkCompare = () => {
    console.log('[SavedEvaluations] Compare requested for:', selectedCount, 'items');
    const idsToCompare = Array.from(selectedIds);
    if (idsToCompare.length > 0) {
      toast.info(`Comparing ${idsToCompare.length} records - opening first record`);
      window.location.href = `/forensic-report/${idsToCompare[0]}`;
    }
  };

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
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            title="Refresh history"
          >
            <svg
              className={`h-5 w-5 text-slate-600 ${isLoading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
<div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-slate-900">
                SAVED EVALUATION SAFARIS
              </h2>
              {/* Select All checkbox - only show when data exists */}
              {sortedEvaluations.length > 0 && (
                <div className="flex items-center gap-2">
                  {/* Select All checkbox - selects ALL records */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={() => {
                        if (isAllSelected) {
                          deselectAll();
                        } else {
                          // Select ALL records (all filtered/sorted results)
                          const allIds = sortedEvaluations.map(item => item.id);
                          setSelectedIds(new Set(allIds));
                        }
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                    />
                    <span className="text-xs text-slate-600 font-medium">
                      {isAllSelected ? 'Deselect All' : 'Select All'}
                    </span>
                  </label>
                </div>
              )}
            </div>
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
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${activeFilter === filter
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

        {/* Bulk Action Toolbar */}
        {selectedCount > 0 && (
          <div className="flex items-center gap-4 border-b border-slate-200 bg-blue-50 px-6 py-2">
            <span className="text-sm font-medium text-blue-700">
              {selectedCount} item{selectedCount > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-300 hover:bg-red-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
              <button
                onClick={handleBulkExport}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-green-600 bg-white border border-green-300 hover:bg-green-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Export
              </button>
              <button
                onClick={handleBulkCompare}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-purple-600 bg-white border border-purple-300 hover:bg-purple-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Compare
              </button>
              <button
                onClick={deselectAll}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}

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
                            {evalItem.steps} steps, 
                            <CoverageDisplay percentage={evalItem.coverage} />
                          </span>
                        </div>
                      </div>
<div className="flex items-center gap-4">
                        <div
                          className={`flex h-6 items-center rounded border px-2 text-xs font-medium ${evalItem.severity === 'CRITICAL'
                            ? 'border-red-400 text-red-600'
                            : evalItem.severity === 'HIGH'
                              ? 'border-yellow-400 text-yellow-600'
                              : 'border-green-400 text-green-600'
                            }`}
                        >
                          {evalItem.severityCount} {evalItem.severity}
                        </div>
{/* Row Action Menu */}
                        <RowActionMenu
                          recordId={evalItem.id}
                          targetUrl={evalItem.targetUrl}
                          onViewReport={() => handleViewReport(evalItem.id)}
                          onExportRecord={() => handleExportRecord(evalItem.id)}
                          onDeleteRecord={() => handleDeleteClick(evalItem.id, evalItem.targetUrl)}
                        />
                        <div className="flex h-6 w-6 items-center justify-center">
                          <svg
                            className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''
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
                        {/* Run Info Header */}
                        <div className="grid grid-cols-5 gap-4 pt-4 mb-4">
                          <div>
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Run ID</div>
                            <div className="text-xs font-mono text-slate-700 truncate" title={evalItem.id}>{evalItem.id.slice(-12)}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Target URL</div>
                            <div className="text-xs text-slate-700 truncate" title={evalItem.targetUrl}>{evalItem.targetUrl}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</div>
                            <div className={`text-xs font-medium ${evalItem.status === 'COMPLETED' ? 'text-green-600' : evalItem.status === 'CRASHED' ? 'text-red-600' : 'text-amber-600'}`}>
                              {evalItem.status}
                            </div>
                          </div>
<div>
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Executed</div>
                            <div className="text-xs text-slate-700">
                              {formatExecutionTime(evalItem.timeElapsed)}
                            </div>
                          </div>
                        </div>

{/* Coverage and Actions Row */}
                        <div className="flex items-center gap-6 mb-4 p-3 bg-white rounded-lg border border-slate-200">
                          <div className="flex-1">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Coverage</div>
                            <CoverageDisplay percentage={evalItem.coverage} />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Actions Executed</div>
                            <div className="text-xs text-slate-700">{evalItem.steps} steps</div>
                          </div>
                        </div>

                        {/* Error Summary Section */}
                        {evalItem.forensicTrace?.caughtBugs && evalItem.forensicTrace.caughtBugs.length > 0 && (
                          <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-xs font-semibold text-red-700 flex items-center gap-2">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                Errors Detected: {evalItem.severityCount}
                              </div>
                              <div className="flex gap-1">
                                {Object.entries(evalItem.bugsByCategory || {}).map(([type, count]) => (
                                  <span key={type} className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-medium">
                                    {type}: {count}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {evalItem.forensicTrace.caughtBugs[0] && (
                              <div className="text-xs text-red-800 bg-white p-2 rounded border border-red-100">
                                <span className="font-semibold">Latest Error: </span>
                                {evalItem.forensicTrace.caughtBugs[0].message}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Reproduction Steps Section */}
                        <div className="mb-4">
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            Reproduction Steps
                          </div>
                          <ReproducibleSteps
                            steps={evalItem.forensicTrace?.finalBreadcrumbSteps || []}
                            findings={evalItem.forensicTrace?.caughtBugs || []}
                          />
                        </div>

                        {/* AI Suggested Fix Section */}
                        <div className="border-t border-slate-200 pt-4">
                          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-700">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            AI SUGGESTED FIX
                          </div>
                          <div className="space-y-3 text-xs text-slate-600">
                            {!evalItem.forensicTrace?.caughtBugs?.length ? (
                              <div className="text-sm text-slate-500 italic">
                                No critical vulnerabilities detected in this trace.
                              </div>
                            ) : (
                              evalItem.forensicTrace?.caughtBugs?.map((bug) => (
                                <div key={bug.bugId} className="p-3 border border-slate-200 rounded">
                                  <div className="font-semibold text-red-600">{bug.type}</div>
                                  <div className="text-slate-700">{bug.message}</div>
                                  {bug.selector && (
                                    <div className="text-xs text-slate-500 mt-1">
                                      Selector: <code className="bg-slate-100 px-1 rounded">{bug.selector}</code>
                                    </div>
                                  )}
                                  {bug.payloadUsed && (
                                    <div className="text-xs text-slate-500 mt-1">
                                      Payload: <code className="bg-slate-100 px-1 rounded truncate">{bug.payloadUsed}</code>
                                    </div>
                                  )}
                                  {bug.advice && (
                                    <div className="mt-2 text-xs text-slate-600">
                                      <span className="font-medium">Advice: </span>{bug.advice}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
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
              className={`h-full flex-1 rounded-full ${idx === 1 ? 'bg-slate-700' : 'bg-slate-200'
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

{/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialogState.isOpen}
        onConfirm={handleDeleteConfirm}
        onClose={handleDeleteClose}
        title="Delete Evaluation Record?"
        message={`Are you sure you want to delete this evaluation record for ${deleteDialogState.targetUrl}? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleteDialogState.isDeleting}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={bulkDeleteDialogState.isOpen}
        onConfirm={handleBulkDeleteConfirm}
        onClose={handleBulkDeleteClose}
        title="Delete Multiple Records?"
        message={`Are you sure you want to delete ${bulkDeleteDialogState.count} evaluation record${bulkDeleteDialogState.count > 1 ? 's' : ''}? This action cannot be undone.`}
        confirmLabel="Delete All"
        isLoading={bulkDeleteDialogState.isDeleting}
      />
    </div>
  );
}

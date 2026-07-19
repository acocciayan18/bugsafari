// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { SessionHistoryEntry } from '../../types';
import { CoverageDisplay } from './CoverageProgressBar';
import { RowActionMenu } from '../common/RowActionMenu';
import { DeleteConfirmDialog } from '../common/DeleteConfirmDialog';
import { deleteRecord as deleteSafariRecord, exportRecord, fetchSessionHistory } from '../../services/historyService';
import { toast } from 'sonner';
import SessionComparisonModal from './SessionComparisonModal';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChartColumn, ChartColumnBig, ChevronRight, CircleQuestionMark, ClipboardCheck, Lock, RefreshCcw, Search, Trash, Trash2, TriangleAlert, Upload } from 'lucide-react';

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
  /** Epoch ms of the run's start — the sortable truth behind the display `date`. */
  startedAtMs: number;
  steps: number;
  coverage: number;
  severity: 'CRITICAL' | 'HIGH' | 'CLEAR';
  severityCount: number;
  status: 'COMPLETED' | 'CRASHED' | 'HALTED';
  timeElapsed: number;
  pagesVisited?: number;
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

// Epoch ms for sorting; 0 for an absent/unparsable timestamp so it sinks to the end.
function toEpochMs(dateStr: string): number {
  const parsed = Date.parse(dateStr);
  return Number.isNaN(parsed) ? 0 : parsed;
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

// Transform API response to evaluation format
function transformToEvaluations(docs: SavedSafariDocument[]): EvaluationSafari[] {
  return docs.map((doc) => {
    const metrics = doc.metrics ?? { totalActions: 0, totalBugsFound: 0, bugsByCategory: {} };
    return {
      id: doc._id,
      targetUrl: doc.targetUrl,
      date: formatDate(doc.executionDate),
      startedAtMs: toEpochMs(doc.executionDate),
      steps: metrics.totalActions,
      coverage: 0,
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
    startedAtMs: toEpochMs(session.startedAt),
    steps: session.actionTraceCount,
    coverage: session.coveragePercentage ?? 0,
    severity: determineSeverity(session.findingCount),
    severityCount: session.findingCount,
    status: mapSessionStatus(session.status),
    timeElapsed: session.runtimeMs ?? 0,
    pagesVisited: session.pagesVisited,
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

const SORT_FIELD_LABELS: Record<SortField, string> = {
  date: 'Date',
  coverage: 'Coverage',
  severity: 'Severity',
  status: 'Status',
};

// Upper bound on side-by-side comparison columns before the table stops being readable.
const MAX_COMPARE = 4;

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
    return <div className="font-mono text-[13px] text-[var(--text-tertiary)]">{stepStr}</div>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="text-sm">{step.actionIcon}</span>
      <span className="font-semibold text-[var(--status-neutral-fg)]">{step.actionType}</span>
      <span className="text-[var(--text-secondary)]">on</span>
      <span className="font-mono text-[var(--status-warning-fg)]">{step.selector}</span>
      {step.payload && (
        <>
          <span className="text-[var(--text-secondary)]">with</span>
          <span className="font-mono text-[var(--status-critical-fg)] max-w-[180px] truncate" title={step.payload}>
            {step.payload.length > 40 ? step.payload.slice(0, 40) + '...' : step.payload}
          </span>
        </>
      )}
    </div>
  );
}

export default function SavedEvaluationSafaris() {
  const navigate = useNavigate();
const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SeverityFilter>('ALL');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'date', direction: 'desc' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [compareIds, setCompareIds] = useState<string[]>([]);
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

  // Handle view report — SPA navigation to the full-screen forensic report page.
  const handleViewReport = (recordId: string) => {
    navigate(`/history/forensic-report/${recordId}`);
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
          // Sort on the underlying timestamp, never the formatted label —
          // "DEC 01, 2025" sorts before "JAN 02, 2026" alphabetically, which is wrong.
          aVal = a.startedAtMs;
          bVal = b.startedAtMs;
          return multiplier * (aVal - bVal);
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

  // Comparison is only meaningful between 2+ runs, and more than 4 columns stops
  // being readable — bound it here rather than rendering an unusable table.
  const handleBulkCompare = () => {
    const idsToCompare = Array.from(selectedIds);
    if (idsToCompare.length < 2) {
      toast.info('Select at least two safaris to compare.');
      return;
    }
    if (idsToCompare.length > MAX_COMPARE) {
      toast.info(`Compare supports up to ${MAX_COMPARE} safaris at a time.`);
      return;
    }
    setCompareIds(idsToCompare);
  };

  return (
    <div className="flex h-full w-full flex-col bg-[var(--surface-app)]">
      <header className="flex items-center justify-between border-b border-[var(--border-hairline)] px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-[var(--text-primary)]">
            BUGSAFARI
          </span>
          <span className="mx-3 text-[var(--text-tertiary)]">/</span>
          <span className="text-sm font-semibold text-[var(--text-secondary)]">
            AUTONOMOUS TESTING ENGINE
          </span>
        </div>
        <div className="flex items-center gap-4">
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            title="Refresh history"
          >
            <RefreshCcw className={`h-5 w-5 text-[var(--text-secondary)] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
            
            <CircleQuestionMark className="h-5 w-5 text-[var(--text-secondary)]" />
          </button>
        </div>
      </header>

      <main className="m-6 mb-0 flex-1 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-panel)]">
<div className="border-b border-[var(--border-hairline)] px-6 py-4">
          <div className="flex items-center justify-between">
<div className="flex items-center gap-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
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
                      className="h-5 w-5 rounded border-[var(--border-strong)] text-[var(--text-secondary)] focus:ring-[var(--border-focus)]"
                    />
                    <span className="text-[13px] text-[var(--text-secondary)] font-medium">
                      {isAllSelected ? 'Deselect All' : 'Select All'}
                    </span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div className="relative">
  <div
    className="
      flex h-10 w-72 items-center rounded-md
      border border-[var(--border-hairline)]
      bg-[var(--surface-app)]
      px-3 py-2
      shadow-sm
      transition-all duration-200
      focus-within:border-[var(--accent-primary)]
      focus-within:ring-1
      focus-within:ring-[var(--accent-primary)]
      focus-within:shadow-md
    "
  >
    <Search className="h-5 w-5 text-[var(--text-tertiary)] transition-colors duration-200 group-focus-within:text-[var(--accent-primary)]" />

    <input
      type="text"
      placeholder="Search URLs..."
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      className="
        ml-2 flex-1 bg-transparent
        text-sm text-[var(--text-primary)]
        placeholder:text-[var(--text-tertiary)]
        focus:outline-none
      "
    />
  </div>
</div>
              {/* Sort controls — field picker + direction toggle */}
              <div className="flex items-center gap-2">
                <label htmlFor="history-sort-field" className="text-[13px] font-medium text-[var(--text-secondary)]">
                  Sort by
                </label>
                <select
                  id="history-sort-field"
                  value={sortConfig.field}
                  onChange={(e) => setSortConfig((prev) => ({ ...prev, field: e.target.value as SortField }))}
                  className="h-8 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
                >
                  {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((field) => (
                    <option key={field} value={field}>{SORT_FIELD_LABELS[field]}</option>
                  ))}
                </select>
                <button
                  onClick={() => setSortConfig((prev) => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                  className="flex h-8 items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
                  title={sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}
                  aria-label={`Sort direction: ${sortConfig.direction === 'asc' ? 'ascending' : 'descending'}`}
                >
                  {sortConfig.direction === 'asc'
                    ? <ArrowUpNarrowWide className="h-4 w-4" />
                    : <ArrowDownWideNarrow className="h-4 w-4" />}
                </button>
              </div>
<div className="flex items-center gap-1 rounded-md bg-[var(--surface-app)] p-1">
                {(['ALL', 'CRITICAL', 'HIGH', 'CLEAR'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${activeFilter === filter
                      ? 'bg-[var(--surface-invert)] text-[var(--text-oninvert)]'
                      : 'bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
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
          <div className="flex items-center gap-4 border-b border-[var(--border-hairline)] bg-[var(--status-neutral-bg)] px-6 py-2">
            <span className="text-sm font-medium text-[var(--status-neutral-fg)]">
              {selectedCount} item{selectedCount > 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-[13px] font-medium text-[var(--status-critical-fg)] bg-[var(--surface-app)] border border-[var(--status-critical-border)] hover:bg-[var(--status-critical-bg)] transition-colors"
              >
               
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
              <button
                onClick={handleBulkExport}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-[13px] font-medium text-[var(--status-stable-fg)] bg-[var(--surface-app)] border border-[var(--status-stable-border)] hover:bg-[var(--status-stable-bg)] transition-colors"
              >
               <Upload className="h-4 w-4" />
                Export
              </button>
              <button
                onClick={handleBulkCompare}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-[13px] font-medium text-[var(--text-primary)] bg-[var(--surface-app)] border border-[var(--border-strong)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <ChartColumnBig className="h-4 w-4" />
                Compare
              </button>
              <button
                onClick={deselectAll}
                className="flex items-center gap-1 rounded px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] bg-[var(--surface-app)] border border-[var(--border-hairline)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Clear Selection
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-[var(--border-hairline)]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border-hairline)] border-t-[var(--text-secondary)]"></div>
              <span className="text-sm text-[var(--text-secondary)]">Loading history...</span>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
             
             <TriangleAlert className="h-12 w-12 text-[var(--status-critical-fg)]" />
              <span className="text-sm font-medium text-[var(--status-critical-fg)]">Failed to load history</span>
              <span className="text-[13px] text-[var(--text-secondary)]">{fetchError}</span>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-app)] px-4 py-2 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Try Again
              </button>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <Lock className="h-12 w-12 text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-secondary)] font-medium">Please log in to view history</span>
              <span className="text-[13px] text-[var(--text-secondary)]">Log in or sign up to access your saved evaluations</span>
              <button
                onClick={() => window.location.href = '/login'}
                className="mt-2 rounded-md bg-[var(--surface-invert)] px-4 py-2 text-[13px] font-medium text-[var(--text-oninvert)] hover:bg-[var(--surface-invert-hover)]"
              >
                Go to Login
              </button>
            </div>
          ) : paginatedEvaluations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <ClipboardCheck className="h-12 w-12 text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-secondary)] font-medium">No evaluation history yet</span>
              <span className="text-[13px] text-[var(--text-secondary)]">Run your first autonomous test and save it to see results here</span>
            </div>
) : (
paginatedEvaluations.map((evalItem) => {
              return (
                <div key={evalItem.id}>
                  <div
                    className="cursor-pointer transition-colors hover:bg-[var(--surface-hover)] active:bg-[var(--surface-inset)] bg-[var(--surface-panel)] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--border-focus)]"
                    role="button"
                    tabIndex={0}
                    aria-label={`View forensic report for ${evalItem.targetUrl}`}
                    onClick={() => handleViewReport(evalItem.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleViewReport(evalItem.id);
                      }
                    }}
                  >
<div className="flex items-center justify-between px-6 py-4">
<div className="flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {evalItem.targetUrl}
                        </div>
<div className="mt-1 flex items-center gap-4 text-[13px] text-[var(--text-secondary)]">
                          <span>ID: {evalItem.id}</span>
                          <span>•</span>
                          <span>{evalItem.date}</span>
                          <span>•</span>
                          <span>
                            {evalItem.steps} steps,
                            <CoverageDisplay percentage={evalItem.coverage} />
                          </span>
                          {typeof evalItem.pagesVisited === 'number' && (
                            <>
                              <span>•</span>
                              <span>{evalItem.pagesVisited} pages</span>
                            </>
                          )}
                        </div>
                      </div>
<div className="flex items-center gap-4">
                        <div
                          className={`flex h-6 items-center rounded border px-2 text-[13px] font-medium ${evalItem.severity === 'CRITICAL'
                            ? 'border-[var(--status-critical-border)] text-[var(--status-critical-fg)]'
                            : evalItem.severity === 'HIGH'
                              ? 'border-[var(--status-warning-border)] text-[var(--status-warning-fg)]'
                              : 'border-[var(--status-stable-border)] text-[var(--status-stable-fg)]'
                            }`}
                        >
                          {evalItem.severityCount} {evalItem.severity}
                        </div>
{/* Row Action Menu — isolate clicks so they don't bubble to the row's navigation handler */}
                        <div onClick={(e) => e.stopPropagation()}>
                          <RowActionMenu
                            recordId={evalItem.id}
                            targetUrl={evalItem.targetUrl}
                            onViewReport={() => handleViewReport(evalItem.id)}
                            onExportRecord={() => handleExportRecord(evalItem.id)}
                            onDeleteRecord={() => handleDeleteClick(evalItem.id, evalItem.targetUrl)}
                          />
                        </div>
                        <div className="flex h-6 w-6 items-center justify-center">
                          <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-6 py-3">
          <div className="flex items-center">
            <span className="font-mono text-[13px] text-[var(--text-secondary)]">
              SHOWING {showingStart}-{showingEnd} OF {displayTotalCount} SAFARIS
            </span>
          </div>
          <div className="flex h-8 gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex h-8 w-8 items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--surface-app)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ‹
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="flex h-8 w-8 items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--surface-app)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
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
              className={`h-full flex-1 rounded-full ${idx === 1 ? 'bg-[var(--surface-invert)]' : 'bg-[var(--surface-raised)]'
                }`}
            />
          ))}
        </div>
        <div className="text-center">
          <span className="font-mono text-[13px] text-[var(--text-tertiary)]">
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

      {/* Side-by-side session comparison */}
      <SessionComparisonModal
        isOpen={compareIds.length > 0}
        onClose={() => setCompareIds([])}
        sessionIds={compareIds}
      />
    </div>
  );
}

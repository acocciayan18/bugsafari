// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../../hooks/useAuth';
import { CoverageDisplay } from './CoverageProgressBar';
import { TerminationBadge } from '../common/TerminationBadge';
import { RowActionMenu } from '../common/RowActionMenu';
import { DeleteConfirmDialog } from '../common/DeleteConfirmDialog';
import { deleteRecord as deleteSafariRecord, exportRecord } from '../../services/historyService';
import { toast } from 'sonner';
import SessionComparisonModal from './SessionComparisonModal';
import { useHistoryStore } from '../../stores/history/historyStore';
import { useHistoryView } from '../../stores/history/useHistoryView';
import { SORT_FIELD_LABELS, type SortField, type SeverityFilter } from '../../stores/history/types';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChartColumnBig, ChevronRight, CircleQuestionMark, ClipboardCheck, Lock, RefreshCcw, Search, Trash2, TriangleAlert, Upload } from 'lucide-react';

// Upper bound on side-by-side comparison columns before the table stops being readable.
const MAX_COMPARE = 4;

export default function SavedEvaluationSafaris() {
  const navigate = useNavigate();
  const { token, isAuthLoading } = useAuth();

  const {
    isLoading, error, searchQuery, activeFilter, sortConfig,
    fetchSessions, removeSessions, setSearchQuery, setActiveFilter, setSortConfig, setCurrentPage,
  } = useHistoryStore(
    useShallow((s) => ({
      isLoading: s.isLoading,
      error: s.error,
      searchQuery: s.searchQuery,
      activeFilter: s.activeFilter,
      sortConfig: s.sortConfig,
      fetchSessions: s.fetchSessions,
      removeSessions: s.removeSessions,
      setSearchQuery: s.setSearchQuery,
      setActiveFilter: s.setActiveFilter,
      setSortConfig: s.setSortConfig,
      setCurrentPage: s.setCurrentPage,
    }))
  );

  const view = useHistoryView();

  // Selection and dialogs are component-scoped and ephemeral — no consumer outside this view.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [bulkDeleteState, setBulkDeleteState] = useState({ isOpen: false, count: 0, isDeleting: false });
  const [deleteState, setDeleteState] = useState<{ isOpen: boolean; recordId: string | null; targetUrl: string; isDeleting: boolean }>({
    isOpen: false, recordId: null, targetUrl: '', isDeleting: false,
  });

  // Intercept transitional mounting frames so no request fires on an uninitialized token
  useEffect(() => {
    if (!token || isAuthLoading) return;
    void fetchSessions();
  }, [token, isAuthLoading, fetchSessions]);

  const handleViewReport = (recordId: string) => {
    navigate(`/history/forensic-report/${recordId}`);
  };

  const handleDeleteConfirm = async () => {
    const { recordId } = deleteState;
    if (!recordId) return;

    setDeleteState((prev) => ({ ...prev, isDeleting: true }));
    try {
      await deleteSafariRecord(recordId);
      removeSessions([recordId]);
      toast.success('Record deleted successfully');
      setDeleteState({ isOpen: false, recordId: null, targetUrl: '', isDeleting: false });
    } catch (err) {
      console.error('[SavedEvaluations] Delete error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete record');
      setDeleteState((prev) => ({ ...prev, isDeleting: false }));
    }
  };

  const handleExportRecord = async (recordId: string) => {
    try {
      await exportRecord(recordId);
      toast.success('Record exported successfully');
    } catch (err) {
      console.error('[SavedEvaluations] Export error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to export record');
    }
  };

  const deselectAll = () => setSelectedIds(new Set());

  const selectedCount = selectedIds.size;
  const isAllSelected = view.sorted.length > 0 && view.sorted.every((item) => selectedIds.has(item.id));

  const handleBulkDeleteConfirm = async () => {
    setBulkDeleteState((prev) => ({ ...prev, isDeleting: true }));

    const idsToDelete = Array.from(selectedIds);
    const settled = await Promise.allSettled(idsToDelete.map((id) => deleteSafariRecord(id)));
    const deletedIds = idsToDelete.filter((_, index) => settled[index].status === 'fulfilled');
    const failedCount = idsToDelete.length - deletedIds.length;

    if (deletedIds.length > 0) {
      removeSessions(deletedIds);
      toast.success(`Deleted ${deletedIds.length} record${deletedIds.length > 1 ? 's' : ''}`);
    }
    if (failedCount > 0) toast.error(`Failed to delete ${failedCount} record${failedCount > 1 ? 's' : ''}`);

    setBulkDeleteState({ isOpen: false, count: 0, isDeleting: false });
    deselectAll();
  };

  const handleBulkExport = async () => {
    const idsToExport = Array.from(selectedIds);
    const settled = await Promise.allSettled(idsToExport.map((id) => exportRecord(id)));
    const exportedCount = settled.filter((r) => r.status === 'fulfilled').length;
    const failedCount = settled.length - exportedCount;

    if (exportedCount > 0) toast.success(`Exported ${exportedCount} record${exportedCount > 1 ? 's' : ''}`);
    if (failedCount > 0) toast.error(`Failed to export ${failedCount} record${failedCount > 1 ? 's' : ''}`);
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

  const progressSegments = [0, 1, 2, 3, 4];

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
          <button
            onClick={() => void fetchSessions(true)}
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
              {/* Select All checkbox - selects ALL filtered records */}
              {view.sorted.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={() => {
                      if (isAllSelected) deselectAll();
                      else setSelectedIds(new Set(view.sorted.map((item) => item.id)));
                    }}
                    className="h-5 w-5 rounded border-[var(--border-strong)] text-[var(--text-secondary)] focus:ring-[var(--border-focus)]"
                  />
                  <span className="text-[13px] text-[var(--text-secondary)] font-medium">
                    {isAllSelected ? 'Deselect All' : 'Select All'}
                  </span>
                </label>
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
                {(['ALL', 'CRITICAL', 'HIGH', 'CLEAR'] as SeverityFilter[]).map((filter) => (
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
                onClick={() => setBulkDeleteState({ isOpen: true, count: selectedCount, isDeleting: false })}
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
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <TriangleAlert className="h-12 w-12 text-[var(--status-critical-fg)]" />
              <span className="text-sm font-medium text-[var(--status-critical-fg)]">Failed to load history</span>
              <span className="text-[13px] text-[var(--text-secondary)]">{error}</span>
              <button
                onClick={() => void fetchSessions(true)}
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
                onClick={() => navigate('/login')}
                className="mt-2 rounded-md bg-[var(--surface-invert)] px-4 py-2 text-[13px] font-medium text-[var(--text-oninvert)] hover:bg-[var(--surface-invert-hover)]"
              >
                Go to Login
              </button>
            </div>
          ) : view.page.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <ClipboardCheck className="h-12 w-12 text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-secondary)] font-medium">
                {view.totalCount === 0 ? 'No evaluation history yet' : 'No safaris match the current filters'}
              </span>
              <span className="text-[13px] text-[var(--text-secondary)]">
                {view.totalCount === 0
                  ? 'Run your first autonomous test and save it to see results here'
                  : 'Adjust the search or severity filter to widen the results'}
              </span>
            </div>
          ) : (
            view.page.map((evalItem) => (
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
                        <span>•</span>
                        <TerminationBadge outcome={evalItem.outcome} status={evalItem.status} reason={evalItem.endedReason} />
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
                          onDeleteRecord={() => setDeleteState({ isOpen: true, recordId: evalItem.id, targetUrl: evalItem.targetUrl, isDeleting: false })}
                        />
                      </div>
                      <div className="flex h-6 w-6 items-center justify-center">
                        <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-6 py-3">
          <div className="flex items-center">
            <span className="font-mono text-[13px] text-[var(--text-secondary)]">
              SHOWING {view.showingStart}-{view.showingEnd} OF {view.matchedCount} SAFARIS
              {view.isFiltered && ` (FILTERED FROM ${view.totalCount})`}
            </span>
          </div>
          <div className="flex h-8 gap-1">
            <button
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={view.safePage === 1}
              className="flex h-8 w-8 items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--surface-app)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ‹
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(view.totalPages, p + 1))}
              disabled={view.safePage >= view.totalPages}
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
        isOpen={deleteState.isOpen}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteState({ isOpen: false, recordId: null, targetUrl: '', isDeleting: false })}
        title="Delete Evaluation Record?"
        message={`Are you sure you want to delete this evaluation record for ${deleteState.targetUrl}? This action cannot be undone.`}
        confirmLabel="Delete"
        isLoading={deleteState.isDeleting}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={bulkDeleteState.isOpen}
        onConfirm={handleBulkDeleteConfirm}
        onClose={() => setBulkDeleteState({ isOpen: false, count: 0, isDeleting: false })}
        title="Delete Multiple Records?"
        message={`Are you sure you want to delete ${bulkDeleteState.count} evaluation record${bulkDeleteState.count > 1 ? 's' : ''}? This action cannot be undone.`}
        confirmLabel="Delete All"
        isLoading={bulkDeleteState.isDeleting}
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

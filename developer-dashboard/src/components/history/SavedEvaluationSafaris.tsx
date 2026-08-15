// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../../hooks/useAuth';
import { Skeleton } from '../ui/Skeleton';
import { TerminationBadge } from '../common/TerminationBadge';
import { RowActionMenu } from '../common/RowActionMenu';
import { DeleteConfirmDialog } from '../common/DeleteConfirmDialog';
import {
  deleteRecord as trashSafariRecord,
  archiveRecord,
  restoreRecord,
  permanentlyDeleteRecord,
  exportRecord,
} from '../../services/historyService';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import { useHistoryStore } from '../../stores/history/historyStore';
import { useHistoryView } from '../../stores/history/useHistoryView';
import { useTour } from '../../tour/useTour';
import { buildHistoryTourSteps } from '../../tour/tourSteps';
import { SORT_FIELD_LABELS, type SortField, type SeverityFilter, type EvaluationSafari } from '../../stores/history/types';
import { INFILTRATION_PROFILE_CATALOG, isImportantSession, type InfiltrationProfileId, type SessionHistoryState } from '../../types';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Calendar, ChevronLeft, ChevronRight, CircleQuestionMark, ClipboardCheck, Hash, Lock, RefreshCcw, Search, TriangleAlert, Undo2 } from 'lucide-react';

// Operator-facing profile label, or '' when the row predates profile recording.
const profileLabel = (id?: InfiltrationProfileId): string =>
  INFILTRATION_PROFILE_CATALOG.find((option) => option.id === id)?.label ?? '';

// History buckets shown as filter chips, in operator order.
const STATE_TABS: { id: SessionHistoryState; label: string }[] = [
  { id: 'active', label: 'ACTIVE' },
  { id: 'archived', label: 'ARCHIVED' },
  { id: 'trashed', label: 'TRASH' },
];

const UNDO_TOAST_ID = 'bugsafari-history-undo';

// Toast with an inline Undo affordance — used after reversible archive/trash so the
// operator can revert without hunting for the row in another bucket.
function emitUndoToast(message: string, onUndo: () => void): void {
  toast.custom(
    (id) => (
      <div className="flex items-center justify-between w-full gap-3">
        <span className="toast-message break-words flex-1 min-w-0">{message}</span>
        <button
          type="button"
          onClick={() => { toast.dismiss(id); onUndo(); }}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold text-(--text-primary) hover:bg-(--surface-hover)"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Undo
        </button>
      </div>
    ),
    { id: UNDO_TOAST_ID, duration: 6000 },
  );
}

export default function SavedEvaluationSafaris() {
  const navigate = useNavigate();
  const { token, isAuthLoading } = useAuth();

  const {
    isLoading, error, searchQuery, activeFilter, stateFilter, sortConfig, lastViewedId,
    fetchSessions, removeSession, setSearchQuery, setActiveFilter, setStateFilter, setSortConfig, setCurrentPage, setLastViewedId,
  } = useHistoryStore(
    useShallow((s) => ({
      isLoading: s.isLoading,
      error: s.error,
      searchQuery: s.searchQuery,
      activeFilter: s.activeFilter,
      stateFilter: s.stateFilter,
      sortConfig: s.sortConfig,
      lastViewedId: s.lastViewedId,
      fetchSessions: s.fetchSessions,
      removeSession: s.removeSession,
      setSearchQuery: s.setSearchQuery,
      setActiveFilter: s.setActiveFilter,
      setStateFilter: s.setStateFilter,
      setSortConfig: s.setSortConfig,
      setCurrentPage: s.setCurrentPage,
      setLastViewedId: s.setLastViewedId,
    }))
  );

  const view = useHistoryView();

  // On-demand tour, replayed from the Help (?) control — not auto-launched, so the
  // page never interrupts on arrival.
  const { startTour } = useTour({ tourId: 'history', enabled: false, buildSteps: buildHistoryTourSteps });

  // Row elements by id — lets the view scroll the last-opened card back after a report visit.
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // On return from a report, bring the previously opened card into view and focus it,
  // then consume the marker so later filter/sort changes don't yank the scroll around.
  useEffect(() => {
    if (isLoading || !lastViewedId) return;
    const el = cardRefs.current.get(lastViewedId);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    setLastViewedId(null);
  }, [isLoading, lastViewedId, view.page, setLastViewedId]);

  // Permanent-delete dialog state — component-scoped and ephemeral. Holds the whole
  // row so the dialog can itemize, gauge importance, and echo the typed-confirm code.
  const [purgeState, setPurgeState] = useState<{ isOpen: boolean; record: EvaluationSafari | null; isDeleting: boolean }>({
    isOpen: false, record: null, isDeleting: false,
  });

  // Intercept transitional mounting frames so no request fires on an uninitialized token
  useEffect(() => {
    if (!token || isAuthLoading) return;
    void fetchSessions();
  }, [token, isAuthLoading, fetchSessions]);

  const handleViewReport = (recordId: string) => {
    setLastViewedId(recordId);
    navigate(`/history/forensic-report/${recordId}`);
  };

  const handleExportRecord = async (recordId: string) => {
    try {
      await exportRecord(recordId);
      toast.success('Record exported successfully');
    } catch (err) {
      console.error('[SavedEvaluations] Export error:', err);
      toast.error("We couldn't export that record. Try again.");
    }
  };

  // Reversible transitions share one shape: drop the row from the current bucket
  // optimistically, call the server, then reconcile. A failure refetches so the row
  // returns rather than vanishing on a lie.
  const handleMoveToTrash = async (recordId: string) => {
    removeSession(recordId);
    try {
      const { retentionDays } = await trashSafariRecord(recordId);
      const window = retentionDays ? ` Auto-deletes in ${retentionDays} days.` : '';
      emitUndoToast(`Moved to Trash.${window}`, () => void handleRestore(recordId, true));
    } catch (err) {
      console.error('[SavedEvaluations] Trash error:', err);
      toast.error("We couldn't move that record to Trash. Try again.");
      void fetchSessions(true);
    }
  };

  const handleArchive = async (recordId: string) => {
    removeSession(recordId);
    try {
      await archiveRecord(recordId);
      emitUndoToast('Record archived.', () => void handleRestore(recordId, true));
    } catch (err) {
      console.error('[SavedEvaluations] Archive error:', err);
      toast.error("We couldn't archive that record. Try again.");
      void fetchSessions(true);
    }
  };

  // Restore from Archive/Trash. `silent` suppresses the success toast when invoked
  // as an Undo (the Undo toast already communicated the reversal).
  const handleRestore = async (recordId: string, silent = false) => {
    if (!silent) removeSession(recordId);
    try {
      await restoreRecord(recordId);
      if (silent) void fetchSessions(true);
      else toast.success('Record restored.');
    } catch (err) {
      console.error('[SavedEvaluations] Restore error:', err);
      toast.error("We couldn't restore that record. Try again.");
      void fetchSessions(true);
    }
  };

  const handlePermanentConfirm = async () => {
    const record = purgeState.record;
    if (!record) return;

    const important = isImportantSession(record.severityCount);
    setPurgeState((prev) => ({ ...prev, isDeleting: true }));
    try {
      // Important records echo their RUN- code as the server-side confirmation token.
      await permanentlyDeleteRecord(record.id, important ? record.id : undefined);
      removeSession(record.id);
      toast.success('Record permanently deleted.');
      setPurgeState({ isOpen: false, record: null, isDeleting: false });
    } catch (err) {
      console.error('[SavedEvaluations] Permanent delete error:', err);
      toast.error("We couldn't delete that record. Try again.");
      setPurgeState((prev) => ({ ...prev, isDeleting: false }));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex h-full w-full flex-col bg-[var(--surface-app)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--border-hairline)] px-4 py-3 sm:px-6 sm:py-3">
        {/* Breadcrumb duplicates the compact top bar — desktop only, actions always stay. */}
        <div className="hidden min-w-0 items-center lg:flex">
          <span className="text-sm font-bold  text-[var(--text-primary)]">
            BUGSAFARI
          </span>
          <span className="mx-3 text-[var(--text-tertiary)]">/</span>
          <span className="truncate text-sm font-semibold text-[var(--text-secondary)]">
            AUTONOMOUS TESTING ENGINE
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4 lg:ml-auto">
          <button
            onClick={() => void fetchSessions(true)}
            disabled={isLoading}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            title="Refresh history"
          >
            <RefreshCcw className={`h-4 w-4 cursor-pointer text-[var(--text-secondary)] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={startTour}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--surface-hover)] transition-colors"
            title="Take a tour of this page"
            aria-label="Take a tour of this page"
          >
            <CircleQuestionMark className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>
      </header>

      <main className="custom-scrollbar m-3 mb-5 flex-1 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-panel)] sm:m-4 sm:mb-5 lg:m-5 lg:mb-5">
        <div className="border-b border-[var(--border-hairline)] px-4 py-4  sm:px-6">
          {/* Title + controls stack into rows until there's width for a single line. */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 xl:gap-6">
              <div data-tour="history-search" className="relative min-w-0 sm:w-56 xl:w-72">
                <div
                  className="
                    flex h-10 w-full items-center rounded-md
                    border border-[var(--border-hairline)]
                    bg-[var(--surface-app)]
                    px-3 py-2
                    shadow-sm
                    transition-all duration-200
                    focus-within:border-[var(--border-focus)]
                    focus-within:ring-1
                    focus-within:ring-[var(--border-focus)]
                  "
                >
                  <Search className="h-5 w-5 shrink-0 text-[var(--text-tertiary)]" />
                  <input
                    type="search"
                    aria-label="Search saved safaris by URL"
                    placeholder="Search URLs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="
                      ml-2 min-w-0 flex-1 bg-transparent
                      text-base sm:text-[13px] text-[var(--text-primary)]
                      placeholder:text-[var(--text-tertiary)]
                      focus:outline-none
                    "
                  />
                </div>
              </div>
              {/* Sort controls — field picker + direction toggle */}
              <div className="flex items-center gap-2">
                <label htmlFor="history-sort-field" className="shrink-0 text-[13px] font-medium text-[var(--text-secondary)]">
                  Sort by
                </label>
                <select
                  id="history-sort-field"
                  value={sortConfig.field}
                  onChange={(e) => setSortConfig((prev) => ({ ...prev, field: e.target.value as SortField }))}
                  className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)] sm:flex-none"
                >
                  {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((field) => (
                    <option key={field} value={field}>{SORT_FIELD_LABELS[field]}</option>
                  ))}
                </select>
                <button
                  onClick={() => setSortConfig((prev) => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                  className="flex h-8 items-center gap-1 cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
                  title={sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}
                  aria-label={`Sort direction: ${sortConfig.direction === 'asc' ? 'ascending' : 'descending'}`}
                >
                  {sortConfig.direction === 'asc'
                    ? <ArrowUpNarrowWide className="h-4 w-4" />
                    : <ArrowDownWideNarrow className="h-4 w-4" />}
                </button>
              </div>
              {/* Lifecycle bucket tabs — Active / Archived / Trash. */}
              <div data-tour="history-buckets" className="scroll-rail flex items-center gap-1 rounded-md bg-[var(--surface-app)] p-1">
                {STATE_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setStateFilter(tab.id)}
                    aria-pressed={stateFilter === tab.id}
                    className={`shrink-0 cursor-pointer rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${stateFilter === tab.id
                      ? 'bg-[var(--surface-invert)] text-[var(--text-oninvert)]'
                      : 'bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
                      }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div data-tour="history-filters" className="scroll-rail flex items-center gap-1 rounded-md bg-[var(--surface-app)] p-1">
                {(['ALL', 'CRITICAL', 'HIGH', 'CLEAR'] as SeverityFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    aria-pressed={activeFilter === filter}
                    className={`shrink-0 cursor-pointer rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${activeFilter === filter
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

        <div data-tour="history-list" className="divide-y divide-[var(--border-hairline)]">
          {isLoading ? (
            // Skeleton rows mirror the real row geometry, so nothing shifts on arrival.
            <div role="status" aria-label="Loading history" className="divide-y divide-[var(--border-hairline)]">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-2/3 max-w-sm" />
                    <Skeleton className="h-3.5 w-full max-w-md" />
                  </div>
                  <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <Skeleton className="hidden h-6 w-6 sm:block" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <TriangleAlert className="h-12 w-12 text-[var(--status-critical-fg)]" />
              <span className="text-[13px] font-medium text-[var(--status-critical-fg)]">We couldn't load your history</span>
              <span className="text-[13px] text-[var(--text-secondary)]">{error}</span>
              <button
                onClick={() => void fetchSessions(true)}
                className="mt-2 rounded-md border cursor-pointer border-[var(--border-strong)] bg-[var(--surface-app)] px-4 py-2 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Try Again
              </button>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <Lock className="h-12 w-12 text-[var(--text-secondary)]" />
              <span className="text-[13px] text-[var(--text-secondary)] font-medium">Please log in to view history</span>
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
              <span className="text-[13px] text-[var(--text-secondary)] font-medium">
                {view.totalCount > 0
                  ? 'No safaris match the current filters'
                  : stateFilter === 'archived' ? 'No archived safaris'
                  : stateFilter === 'trashed' ? 'Trash is empty'
                  : 'No evaluation history yet'}
              </span>
              <span className="text-[13px] text-[var(--text-secondary)]">
                {view.totalCount > 0
                  ? 'Adjust the search or severity filter to widen the results'
                  : stateFilter === 'archived' ? 'Archive a safari to park it here without deleting it'
                  : stateFilter === 'trashed' ? 'Deleted safaris wait here until you restore or purge them'
                  : 'Run your first test on the Dashboard and save it to see results here'}
              </span>
              {view.totalCount === 0 && stateFilter === 'active' && (
                <button
                  onClick={() => navigate('/dashboard')}
                  className="mt-2 rounded-md bg-[var(--surface-invert)] px-4 py-2 text-[13px] font-medium text-[var(--text-oninvert)] hover:bg-[var(--surface-invert-hover)]"
                >
                  Go to Dashboard
                </button>
              )}
            </div>
          ) : (
            view.page.map((evalItem, index) => (
              <motion.div
                key={evalItem.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                // Capped so a full page never front-loads a long wait on the last row.
                transition={{ duration: 0.2, ease: 'easeOut', delay: Math.min(index, 8) * 0.025 }}
              >
                <div
                  ref={(el) => { if (el) cardRefs.current.set(evalItem.id, el); else cardRefs.current.delete(evalItem.id); }}
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
                  {/* Metadata wraps instead of overflowing; separators are drawn by the
                      wrapper so a wrapped line never starts with a stray bullet. */}
                  <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-medium text-[var(--text-primary)]">
                        {evalItem.targetUrl}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--text-secondary)] sm:gap-x-3">
                       <span className="inline-flex items-center truncate font-mono">
                          <Hash className="mr-1 h-3 w-3 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                          <span>{evalItem.runId ?? evalItem.id}</span>
                        </span>
                        <span className="inline-flex items-center truncate font-mono">
                          <Calendar className="mr-1 h-3 w-3 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
                          <span>{evalItem.date}</span>
                        </span>

                        <span aria-hidden="true">•</span>
                        <span>{evalItem.steps} steps</span>
                        {/* Which profile produced these findings — absent on rows saved before it was recorded. */}
                        {profileLabel(evalItem.infiltrationProfile) && (
                          <>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">{profileLabel(evalItem.infiltrationProfile)}</span>
                          </>
                        )}
                        <span aria-hidden="true">•</span>
                        <TerminationBadge outcome={evalItem.outcome} status={evalItem.status} reason={evalItem.endedReason} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                      <div
                        className={`flex h-6 items-center rounded border px-2 text-[13px] font-medium ${evalItem.severity === 'CRITICAL' || evalItem.severity === 'HIGH'
                          ? 'border-[var(--status-critical-border)] text-[var(--status-critical-fg)]'
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
                          state={evalItem.state}
                          onViewReport={() => handleViewReport(evalItem.id)}
                          onExportRecord={() => handleExportRecord(evalItem.id)}
                          onArchive={() => void handleArchive(evalItem.id)}
                          onRestore={() => void handleRestore(evalItem.id)}
                          onMoveToTrash={() => void handleMoveToTrash(evalItem.id)}
                          onDeleteForever={() => setPurgeState({ isOpen: true, record: evalItem, isDeleting: false })}
                        />
                      </div>
                      <div className="hidden h-6 w-6 items-center justify-center sm:flex">
                        <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-hairline)] px-4 py-3 sm:px-6">
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
              className="flex h-8 w-8 items-center justify-center rounded border border-(--border-strong) bg-(--surface-app) text-[13px] text-(--text-secondary) hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(view.totalPages, p + 1))}
              disabled={view.safePage >= view.totalPages}
              className="flex h-8 w-8 items-center justify-center rounded border border-(--border-strong) bg-(--surface-app) text-[13px] text-(--text-secondary) hover:bg-(--surface-hover) disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </main>

      {/* Permanent-delete confirmation — itemizes exactly what is destroyed and, for
          important (CRITICAL) records, gates the action behind the typed RUN- code. */}
      <DeleteConfirmDialog
        isOpen={purgeState.isOpen}
        onConfirm={() => void handlePermanentConfirm()}
        onClose={() => setPurgeState({ isOpen: false, record: null, isDeleting: false })}
        title="Delete permanently?"
        message={`This permanently removes the evaluation for ${purgeState.record?.targetUrl ?? 'this run'} and everything captured with it. This cannot be undone.`}
        confirmLabel="Delete forever"
        isLoading={purgeState.isDeleting}
        confirmationPhrase={purgeState.record && isImportantSession(purgeState.record.severityCount) ? purgeState.record.id : undefined}
      />
    </motion.div>
  );
}

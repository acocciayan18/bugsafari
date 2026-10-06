// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDismissableLayer } from '../../hooks/useDismissableLayer';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../../hooks/useAuth';
import { Skeleton } from '../ui/Skeleton';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { TerminationBadge } from '../common/TerminationBadge';
import { RowActionMenu } from '../common/RowActionMenu';
import { DeleteConfirmDialog } from '../common/DeleteConfirmDialog';
import { ShareLinkModal } from './ShareLinkModal';
import {
  deleteRecord as trashSafariRecord,
  archiveRecord,
  restoreRecord,
  permanentlyDeleteRecord,
} from '../../services/historyService';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import { useHistoryStore } from '../../stores/history/historyStore';
import { useHistoryView } from '../../stores/history/useHistoryView';
import { useTour } from '../../tour/useTour';
import { buildHistoryTourSteps } from '../../tour/tourSteps';
import { SORT_FIELD_LABELS, type SortField, type SeverityFilter, type EvaluationSafari } from '../../stores/history/types';
import { INFILTRATION_PROFILE_CATALOG, isImportantSession, type InfiltrationProfileId, type SessionHistoryState } from '../../types';
import { ArrowDownUp, ArrowDownWideNarrow, ArrowUpNarrowWide, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, CircleQuestionMark, ClipboardCheck, Hash, Layers, Lock, RefreshCcw, Search, SignalHigh, TriangleAlert, Undo2 } from 'lucide-react';

// Operator-facing profile label, or '' when the row predates profile recording.
const profileLabel = (id?: InfiltrationProfileId): string =>
  INFILTRATION_PROFILE_CATALOG.find((option) => option.id === id)?.label ?? '';

// History buckets shown as filter chips, in operator order.
const STATE_TABS: { value: SessionHistoryState; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trashed', label: 'Trash' },
];

// Sort fields as dropdown options — mirrors SORT_FIELD_LABELS in operator order.
const SORT_FIELD_TABS: { value: SortField; label: string }[] = (Object.keys(SORT_FIELD_LABELS) as SortField[])
  .map((field) => ({ value: field, label: SORT_FIELD_LABELS[field] }));

// Severity buckets, in descending urgency.
const SEVERITY_TABS: { value: SeverityFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
  { value: 'CLEAR', label: 'Clear' },
];

// Severity badge palette — maps each real tier to a status token pair. CRITICAL/HIGH
// share the critical accent, MEDIUM/LOW the amber warning, INFO the neutral, CLEAR the
// stable green. Keeps the badge truthful about the worst finding present.
const SEVERITY_BADGE_CLASS: Record<string, string> = {
  CRITICAL: 'border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)]',
  HIGH: 'border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)]',
  MEDIUM: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  LOW: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  INFO: 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]',
  CLEAR: 'border-[var(--status-stable-border)] bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)]',
};

// Accent dot per severity tier — mirrors the badge palette so the menu reads at a glance.
const SEVERITY_DOT_CLASS: Record<string, string> = {
  ALL: 'bg-[var(--text-tertiary)]',
  CRITICAL: 'bg-[var(--status-critical-fg)]',
  HIGH: 'bg-[var(--status-critical-fg)]',
  MEDIUM: 'bg-[var(--status-warning-fg)]',
  LOW: 'bg-[var(--status-warning-fg)]',
  CLEAR: 'bg-[var(--status-stable-fg)]',
};

// Compact filter dropdown — trigger shows the active choice, popover lists the rest.
// Menu behavior (dismiss/keyboard) reuses the shared RowActionMenu pattern for consistency.
function FilterDropdown<T extends string>({ options, value, onChange, ariaLabel, dataTour, icon, dots, className = '' }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  dataTour?: string;
  icon: React.ReactNode;
  dots?: Record<string, string>;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { setIsOpen(false); buttonRef.current?.focus(); };
  const menuRef = useDismissableLayer<HTMLDivElement>({ isOpen, onDismiss: closeMenu });
  const active = options.find((o) => o.value === value);

  return (
    <div ref={menuRef} data-tour={dataTour} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] pl-2.5 pr-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)] sm:h-8 sm:w-auto sm:justify-start sm:pl-2 sm:pr-1.5"
      >
        <span className="text-[var(--text-tertiary)]">{icon}</span>
        {dots && <span className={`h-2 w-2 shrink-0 rounded-full ${dots[value] ?? dots.ALL}`} aria-hidden="true" />}
        <span className="flex-1 truncate text-left sm:flex-initial">{active?.label ?? ''}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.ul
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            role="listbox"
            aria-label={ariaLabel}
            className="absolute left-0 top-full z-50 mt-2 min-w-full max-w-[calc(100vw-2rem)] origin-top overflow-hidden rounded-(--radius-lg) border border-(--border-hairline) bg-(--surface-raised) py-1 shadow-(--shadow-md) sm:min-w-[10rem]"
          >
            {options.map((opt) => (
              <li key={opt.value} role="option" aria-selected={opt.value === value}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.value); closeMenu(); }}
                  className={`flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${opt.value === value ? 'bg-(--accent-soft-bg) font-semibold text-(--accent-soft-fg)' : 'text-(--text-secondary) hover:bg-(--surface-hover)'}`}
                >
                  {dots && <span className={`h-2 w-2 shrink-0 rounded-full ${dots[opt.value] ?? dots.ALL}`} aria-hidden="true" />}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.value === value && <Check className="h-4 w-4 shrink-0 text-(--accent)" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// Windowed page list with ellipsis gaps — keeps the control at a fixed width on large sets.
function pageItems(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  const items: (number | 'gap')[] = [1];
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < total - 1) items.push('gap');
  items.push(total);
  return items;
}

const UNDO_TOAST_ID = 'bugsafari-history-undo';

// Toast with an inline Undo affordance — used after reversible archive/trash so the
// operator can revert without hunting for the row in another bucket. Routed through the
// shared actionable-toast primitive so every View/Undo toast reads identically.
function emitUndoToast(message: string, onUndo: () => void): void {
  toast.action(
    message,
    { label: 'Undo', onClick: onUndo, icon: <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> },
    { id: UNDO_TOAST_ID },
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

  // Record whose view-only share links are being managed; null closes the dialog.
  const [shareRecordId, setShareRecordId] = useState<string | null>(null);

  // Intercept transitional mounting frames so no request fires on an uninitialized token
  useEffect(() => {
    if (!token || isAuthLoading) return;
    void fetchSessions();
  }, [token, isAuthLoading, fetchSessions]);

  const handleViewReport = (recordId: string) => {
    setLastViewedId(recordId);
    navigate(`/history/forensic-report/${recordId}`);
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

    const important = isImportantSession(record.findingCount);
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
      className="flex w-full flex-col bg-[var(--surface-app)] lg:h-full"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-hairline)] px-4 py-3 sm:px-6 sm:py-3">
        {/* Breadcrumb stays visible on mobile; it truncates before it can crowd the actions. */}
        <div className="flex min-w-0 items-center">
          <span className="shrink-0 text-body-sm font-bold text-[var(--text-primary)] sm:text-sm">
            BUGSAFARI
          </span>
          <span className="mx-2 shrink-0 text-[var(--text-tertiary)] sm:mx-3">/</span>
          <span className="truncate text-body-sm font-semibold text-[var(--text-secondary)] sm:text-sm">
            HISTORY SESSION
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

      <main className="custom-scrollbar m-3 mb-5 overflow-visible rounded-(--radius-lg) border border-(--border-hairline) bg-(--surface-panel) shadow-(--shadow-sm) sm:m-4 sm:mb-5 lg:m-5 lg:mb-5 lg:flex-1 lg:overflow-auto">
        <div className="border-b border-[var(--border-hairline)] px-4 py-4  sm:px-6">
          {/* Title + controls stack into rows until there's width for a single line. */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              {/* ui/Input reused; leading search icon overlaid since Input has no icon slot. */}
              <div data-tour="history-search" className="relative min-w-0 sm:w-56 xl:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-tertiary)" aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="Search saved safaris by URL"
                  placeholder="Search URLs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 sm:text-[13px]"
                />
              </div>
              {/* Sort controls — field picker + direction toggle */}
              <div data-tour="history-sort" className="flex items-center gap-2">
                <label className="shrink-0 text-[13px] font-medium text-[var(--text-secondary)]">
                  Sort by
                </label>
                <FilterDropdown
                  className="flex-1 sm:flex-initial"
                  ariaLabel="Sort by field"
                  icon={<ArrowDownUp className="h-4 w-4" />}
                  options={SORT_FIELD_TABS}
                  value={sortConfig.field}
                  onChange={(field) => setSortConfig((prev) => ({ ...prev, field }))}
                />
                <button
                  onClick={() => setSortConfig((prev) => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                  className="flex h-10 shrink-0 items-center gap-1 cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-3 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors sm:h-8 sm:px-2"
                  title={sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}
                  aria-label={`Sort direction: ${sortConfig.direction === 'asc' ? 'ascending' : 'descending'}`}
                >
                  {sortConfig.direction === 'asc'
                    ? <ArrowUpNarrowWide className="h-4 w-4" />
                    : <ArrowDownWideNarrow className="h-4 w-4" />}
                </button>
              </div>
              {/* Lifecycle + severity filters — compact dropdowns, grouped so they stay paired on wrap. */}
              <div className="flex items-center gap-2">
                <FilterDropdown
                  className="flex-1 sm:flex-initial"
                  dataTour="history-buckets"
                  ariaLabel="Filter by lifecycle state"
                  icon={<Layers className="h-4 w-4" />}
                  options={STATE_TABS}
                  value={stateFilter}
                  onChange={setStateFilter}
                />
                <FilterDropdown
                  className="flex-1 sm:flex-initial"
                  dataTour="history-filters"
                  ariaLabel="Filter by severity"
                  icon={<SignalHigh className="h-4 w-4" />}
                  dots={SEVERITY_DOT_CLASS}
                  options={SEVERITY_TABS}
                  value={activeFilter}
                  onChange={setActiveFilter}
                />
              </div>
            </div>
          </div>
        </div>

        <div data-tour="history-list" className="flex flex-col gap-3 p-3 sm:p-4 lg:p-5">
          {isLoading ? (
            // Skeleton cards mirror the real card geometry, so nothing shifts on arrival.
            <div role="status" aria-label="Loading history" className="flex flex-col gap-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex flex-col gap-3 rounded-(--radius-lg) border border-(--border-hairline) bg-(--surface-raised) px-4 py-4 shadow-(--shadow-sm) sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
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
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => void fetchSessions(true)}>
                Try Again
              </Button>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
              <Lock className="h-12 w-12 text-[var(--text-secondary)]" />
              <span className="text-[13px] text-[var(--text-secondary)] font-medium">Please log in to view history</span>
              <span className="text-[13px] text-[var(--text-secondary)]">Log in or sign up to access your saved evaluations</span>
              <Button variant="primary" size="sm" className="mt-2" onClick={() => navigate('/login')}>
                Go to Login
              </Button>
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
                <Button variant="primary" size="sm" className="mt-2" onClick={() => navigate('/dashboard')}>
                  Go to Dashboard
                </Button>
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
                  className="cursor-pointer rounded-(--radius-lg) border border-(--border-hairline) bg-(--surface-raised) shadow-(--shadow-sm) transition-all duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-0.5 hover:border-(--border-strong) hover:shadow-(--shadow-md) active:translate-y-0 active:bg-(--surface-hover) focus:outline-none focus:ring-2 focus:ring-(--border-focus)"
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
                  <div className="relative flex flex-col gap-3 px-4 py-4 pr-16 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:pr-6">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-medium text-[var(--text-primary)]">
                        {evalItem.targetUrl}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
                        {/* Session ID, Date, and Status each sit in a subtle neutral badge so they read as distinct chips, not a run-on line. */}
                        <span className="inline-flex min-h-6 items-center truncate rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-inset) px-2 py-0.5 font-mono font-normal text-(--text-secondary)">
                          <Hash className="mr-1 h-3 w-3 shrink-0 text-(--text-tertiary)" aria-hidden="true" />
                          <span className="truncate">{evalItem.runId ?? evalItem.id}</span>
                        </span>
                        <span className="inline-flex min-h-6 items-center truncate rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-inset) px-2 py-0.5 font-mono font-normal text-(--text-secondary)">
                          <Calendar className="mr-1 h-3 w-3 shrink-0 text-(--text-tertiary)" aria-hidden="true" />
                          <span className="truncate">{evalItem.date}</span>
                        </span>

                        {/* Which profile produced these findings, absent on rows saved before it was recorded. */}
                        {profileLabel(evalItem.infiltrationProfile) && (
                          <span className="inline-flex min-h-6 items-center truncate rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-inset) px-2 py-0.5 text-(--text-secondary)">
                            {profileLabel(evalItem.infiltrationProfile)}
                          </span>
                        )}
                        <TerminationBadge variant="mono" outcome={evalItem.outcome} status={evalItem.status} reason={evalItem.endedReason} />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                      <div
                        title={`Worst finding: ${evalItem.severity} (${evalItem.findingCount} total)`}
                        className={`flex h-6 items-center rounded-(--radius-sm) border px-2 text-[13px] font-medium ${SEVERITY_BADGE_CLASS[evalItem.severity] ?? SEVERITY_BADGE_CLASS.CLEAR}`}
                      >
                        {evalItem.severityCount} {evalItem.severity}
                      </div>
                      {/* Row Action Menu — pinned top-right on mobile, inline on desktop. Isolate clicks so they don't bubble to the row's navigation handler */}
                      <div className="absolute right-3 top-3 sm:static" onClick={(e) => e.stopPropagation()}>
                        <RowActionMenu
                          recordId={evalItem.id}
                          targetUrl={evalItem.targetUrl}
                          state={evalItem.state}
                          onViewReport={() => handleViewReport(evalItem.id)}
                          onShare={() => setShareRecordId(evalItem.id)}
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

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-[var(--border-hairline)] px-4 py-3 sm:px-6">
          <span className="font-mono text-[13px] text-[var(--text-secondary)]">
            Showing {view.showingStart}-{view.showingEnd} of {view.matchedCount} Safaris
            {view.isFiltered && ` (Filtered from ${view.totalCount})`}
          </span>
          <nav aria-label="History pagination" className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={view.safePage === 1}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-(--radius-md) border border-(--border-strong) bg-(--surface-app) text-(--text-secondary) transition-colors hover:bg-(--surface-hover) disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {/* Compact page indicator on narrow widths; numbered buttons take over from sm up. */}
            <span className="px-2 font-mono text-[13px] text-[var(--text-secondary)] sm:hidden">
              {view.safePage} / {view.totalPages}
            </span>
            <div className="hidden items-center gap-1 sm:flex">
              {pageItems(view.safePage, view.totalPages).map((item, index) =>
                item === 'gap' ? (
                  <span key={`gap-${index}`} aria-hidden="true" className="flex h-8 w-8 items-center justify-center text-[13px] text-[var(--text-tertiary)]">…</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setCurrentPage(() => item)}
                    aria-label={`Page ${item}`}
                    aria-current={item === view.safePage ? 'page' : undefined}
                    className={`flex h-8 min-w-8 items-center justify-center rounded-(--radius-md) border px-2 text-[13px] font-medium transition-colors ${item === view.safePage
                      ? 'border-(--accent) bg-(--accent) text-(--accent-fg)'
                      : 'border-(--border-strong) bg-(--surface-app) text-(--text-secondary) hover:bg-(--surface-hover)'
                      }`}
                  >
                    {item}
                  </button>
                )
              )}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(view.totalPages, p + 1))}
              disabled={view.safePage >= view.totalPages}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-(--radius-md) border border-(--border-strong) bg-(--surface-app) text-(--text-secondary) transition-colors hover:bg-(--surface-hover) disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </main>

      {/* Permanent-delete confirmation — itemizes exactly what is destroyed and, for
          important (CRITICAL) records, gates the action behind the typed RUN- code. */}
      <DeleteConfirmDialog
        isOpen={purgeState.isOpen}
        onConfirm={() => void handlePermanentConfirm()}
        onClose={() => setPurgeState({ isOpen: false, record: null, isDeleting: false })}
        title="Delete permanently?"
        message={`This permanently removes the evaluation for ${purgeState.record?.targetUrl ?? 'this run'} and everything captured with it, including any active share links, which stop working immediately. This cannot be undone.`}
        confirmLabel="Delete forever"
        isLoading={purgeState.isDeleting}
        confirmationPhrase={purgeState.record && isImportantSession(purgeState.record.findingCount) ? purgeState.record.id : undefined}
      />

      {/* View-only share links — create with an expiry, then list, copy, and revoke. */}
      <ShareLinkModal
        recordId={shareRecordId}
        isOpen={shareRecordId !== null}
        onClose={() => setShareRecordId(null)}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SavedEvaluationSafaris - Forensic History Page
// ═══════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '../../hooks/useAuth';
import { Skeleton } from '../ui/Skeleton';
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
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Calendar, ChevronLeft, ChevronRight, CircleQuestionMark, ClipboardCheck, Fingerprint, Globe, Hash, Lock, RefreshCcw, Search, ShieldAlert, ShieldCheck, TriangleAlert, Undo2 } from 'lucide-react';

// Severity theme — Critical (crimson), High (amber), Clear (green). Drives the card
// accent stripe, the leading icon tile and the findings pill so level reads at a glance.
const SEVERITY_META: Record<EvaluationSafari['severity'], {
  label: string;
  Icon: typeof ShieldAlert;
  accent: string;
  tile: string;
  pill: string;
}> = {
  CRITICAL: {
    label: 'Critical',
    Icon: ShieldAlert,
    accent: 'bg-[var(--status-critical-fg)]',
    tile: 'border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)]',
    pill: 'border-[var(--status-critical-border)] bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)]',
  },
  HIGH: {
    label: 'High',
    Icon: TriangleAlert,
    accent: 'bg-[var(--status-warning-fg)]',
    tile: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
    pill: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  },
  CLEAR: {
    label: 'Clear',
    Icon: ShieldCheck,
    accent: 'bg-[var(--status-stable-fg)]',
    tile: 'border-[var(--status-stable-border)] bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)]',
    pill: 'border-[var(--status-stable-border)] bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)]',
  },
};

// Plain-language finding count for the card pill.
const findingsLabel = (n: number): string => (n === 0 ? 'No findings' : n === 1 ? '1 finding' : `${n} findings`);

// Bordered metadata chip — run id, date, profile read as structured report fields.
function MetaChip({ icon: Icon, mono = false, children }: { icon: typeof Hash; mono?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-[var(--border-hairline)] bg-[var(--surface-inset)] px-2 py-0.5 text-xs text-[var(--text-secondary)] ${mono ? 'font-mono' : ''}`}>
      <Icon className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

// Operator-facing profile label, or '' when the row predates profile recording.
const profileLabel = (id?: InfiltrationProfileId): string =>
  INFILTRATION_PROFILE_CATALOG.find((option) => option.id === id)?.label ?? '';

// History buckets shown as filter chips, in operator order.
const STATE_TABS: { value: SessionHistoryState; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'trashed', label: 'Trash' },
];

// Severity buckets, in descending urgency.
const SEVERITY_TABS: { value: SeverityFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'CLEAR', label: 'Clear' },
];

// Compact segmented control — one-click filter switch aligned to the 32px toolbar row.
function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel, dataTour }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      role="group"
      aria-label={ariaLabel}
      className="scroll-rail inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`shrink-0 cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors ${value === opt.value
            ? 'bg-[var(--surface-invert)] text-[var(--text-oninvert)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
            }`}
        >
          {opt.label}
        </button>
      ))}
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

      <main className="custom-scrollbar m-3 mb-5 flex-1 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-panel)] sm:m-4 sm:mb-5 lg:m-5 lg:mb-5">
        <div className="sticky top-0 z-10 border-b border-[var(--border-hairline)] bg-[var(--surface-panel)] px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4">
            {/* Report heading with a live result count. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">Forensic History</h1>
                <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">Saved exploratory safaris and the findings they surfaced.</p>
              </div>
              {!isLoading && token && !error && (
                <span className="shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-inset)] px-2.5 py-1 font-mono text-xs font-medium text-[var(--text-secondary)]">
                  {view.matchedCount} {view.matchedCount === 1 ? 'safari' : 'safaris'}
                </span>
              )}
            </div>

            {/* Search, sort and filters — stack on mobile, single line from lg up. */}
            <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-4">
              <div data-tour="history-search" className="relative min-w-0 lg:w-64 xl:w-72">
                <label htmlFor="history-search-input" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Search</label>
                <div className="flex h-10 w-full items-center rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-3 shadow-sm transition-all duration-200 focus-within:border-[var(--border-focus)] focus-within:ring-1 focus-within:ring-[var(--border-focus)]">
                  <Search className="h-5 w-5 shrink-0 text-[var(--text-tertiary)]" />
                  <input
                    id="history-search-input"
                    type="search"
                    aria-label="Search saved safaris by URL"
                    placeholder="Search URLs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="ml-2 min-w-0 flex-1 bg-transparent text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none sm:text-[13px]"
                  />
                </div>
              </div>

              {/* Sort controls — field picker + direction toggle */}
              <div className="min-w-0">
                <label htmlFor="history-sort-field" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Sort by</label>
                <div className="flex items-center gap-2">
                  <select
                    id="history-sort-field"
                    value={sortConfig.field}
                    onChange={(e) => setSortConfig((prev) => ({ ...prev, field: e.target.value as SortField }))}
                    className="h-10 min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] px-2.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none sm:flex-none"
                  >
                    {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((field) => (
                      <option key={field} value={field}>{SORT_FIELD_LABELS[field]}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setSortConfig((prev) => ({ ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--surface-app)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
                    title={sortConfig.direction === 'asc' ? 'Ascending' : 'Descending'}
                    aria-label={`Sort direction: ${sortConfig.direction === 'asc' ? 'ascending' : 'descending'}`}
                  >
                    {sortConfig.direction === 'asc'
                      ? <ArrowUpNarrowWide className="h-4 w-4" />
                      : <ArrowDownWideNarrow className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Lifecycle + severity filters — labeled segmented controls. */}
              <div className="min-w-0">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Bucket</span>
                <SegmentedControl
                  dataTour="history-buckets"
                  ariaLabel="Filter by lifecycle state"
                  options={STATE_TABS}
                  value={stateFilter}
                  onChange={setStateFilter}
                />
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Severity</span>
                <SegmentedControl
                  dataTour="history-filters"
                  ariaLabel="Filter by severity"
                  options={SEVERITY_TABS}
                  value={activeFilter}
                  onChange={setActiveFilter}
                />
              </div>
            </div>
          </div>
        </div>

        <div data-tour="history-list" className="flex flex-col gap-3 p-3 sm:p-4">
          {isLoading ? (
            // Skeleton cards mirror the real card geometry, so nothing shifts on arrival.
            <div role="status" aria-label="Loading history" className="flex flex-col gap-3">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex items-center gap-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] py-4 pl-5 pr-4">
                  <Skeleton className="hidden h-10 w-10 rounded-md sm:block" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-2/3 max-w-sm" />
                    <Skeleton className="h-4 w-full max-w-md" />
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-6 w-6 rounded-full" />
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
            view.page.map((evalItem, index) => {
              const sev = SEVERITY_META[evalItem.severity];
              return (
                <motion.div
                  key={evalItem.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  // Capped so a full page never front-loads a long wait on the last row.
                  transition={{ duration: 0.2, ease: 'easeOut', delay: Math.min(index, 8) * 0.025 }}
                >
                  <div
                    ref={(el) => { if (el) cardRefs.current.set(evalItem.id, el); else cardRefs.current.delete(evalItem.id); }}
                    className="group relative flex items-center gap-3 overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] py-3.5 pl-4 pr-3 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-focus)] sm:gap-4 sm:py-4 sm:pl-5 sm:pr-4"
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
                    {/* Severity accent stripe + icon tile carry the level without relying on color alone. */}
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${sev.accent}`} />
                    <div className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-md border sm:flex ${sev.tile}`}>
                      <sev.Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] sm:hidden" aria-hidden="true" />
                        <span className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{evalItem.targetUrl}</span>
                      </div>
                      {/* Structured report fields — wrap instead of overflowing. */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <MetaChip icon={Hash} mono>{evalItem.runId ?? evalItem.id}</MetaChip>
                        <MetaChip icon={Calendar} mono>{evalItem.date}</MetaChip>
                        {profileLabel(evalItem.infiltrationProfile) && (
                          <MetaChip icon={Fingerprint}>{profileLabel(evalItem.infiltrationProfile)}</MetaChip>
                        )}
                        <TerminationBadge outcome={evalItem.outcome} status={evalItem.status} reason={evalItem.endedReason} />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                      <div className="flex flex-col items-end gap-1">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${sev.pill}`}>
                          <sev.Icon className="h-3.5 w-3.5 sm:hidden" strokeWidth={1.75} aria-hidden="true" />
                          {sev.label}
                        </span>
                        <span className="text-xs text-[var(--text-tertiary)]">{findingsLabel(evalItem.severityCount)}</span>
                      </div>
                      {/* Row Action Menu — isolate clicks so they don't bubble to the card's navigation handler */}
                      <div onClick={(e) => e.stopPropagation()}>
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
                      <ChevronRight className="hidden h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden="true" />
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        {!isLoading && token && !error && view.matchedCount > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-[var(--border-hairline)] bg-[var(--surface-panel)] px-4 py-3 sm:px-6">
          <span className="font-mono text-[13px] text-[var(--text-secondary)]">
            SHOWING {view.showingStart}-{view.showingEnd} OF {view.matchedCount} SAFARIS
            {view.isFiltered && ` (FILTERED FROM ${view.totalCount})`}
          </span>
          <nav aria-label="History pagination" className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={view.safePage === 1}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded border border-(--border-strong) bg-(--surface-app) text-(--text-secondary) transition-colors hover:bg-[var(--surface-hover)] disabled:pointer-events-none disabled:opacity-40"
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
                    className={`flex h-8 min-w-8 items-center justify-center rounded border px-2 text-[13px] font-medium transition-colors ${item === view.safePage
                      ? 'border-[var(--surface-invert)] bg-[var(--surface-invert)] text-[var(--text-oninvert)]'
                      : 'border-(--border-strong) bg-(--surface-app) text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
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
              className="flex h-8 w-8 items-center justify-center rounded border border-(--border-strong) bg-(--surface-app) text-(--text-secondary) transition-colors hover:bg-(--surface-hover) disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        </div>
        )}
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

      {/* View-only share links — create with an expiry, then list, copy, and revoke. */}
      <ShareLinkModal
        recordId={shareRecordId}
        isOpen={shareRecordId !== null}
        onClose={() => setShareRecordId(null)}
      />
    </motion.div>
  );
}

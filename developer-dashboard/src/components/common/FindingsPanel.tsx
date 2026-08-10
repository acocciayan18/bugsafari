// ═══════════════════════════════════════════════════════════════
// FindingsPanel - the ONE organizer that wraps a list of findings
// with category/severity filters, sort, and collapsible severity
// groups. Shared by the live Errors tab and the saved Forensic
// Report so both views categorize, prioritize, and label findings
// identically. It is presentation-only: callers pass entries that
// know how to render their own card (live FindingCard vs the report's
// Verify-Fix card), so no card logic is duplicated here.
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  BUG_CATEGORY_META,
  BUG_CATEGORY_ORDER,
  SEVERITY_ORDER,
  SEVERITY_RANK,
  type BugCategory,
  type FaultSeverity,
} from '../../../../shared/types.js';
import type { FindingView } from '../../utils/findingView';

// A finding plus how to render its card — the panel groups/filters/sorts by
// `view` and defers the actual card to `render(displayIndex)`.
export interface FindingEntry {
  key: string;
  view: FindingView;
  render: (displayIndex: number) => ReactNode;
}

// Severity-first display order (Critical → Info) for section headers + chips.
const SEVERITY_DESC: readonly FaultSeverity[] = [...SEVERITY_ORDER].reverse();

const SEV_PRESENTATION: Record<FaultSeverity, { label: string; dot: string; text: string }> = {
  CRITICAL: { label: 'Critical', dot: 'bg-(--status-critical-fg)', text: 'text-(--status-critical-fg)' },
  HIGH: { label: 'High', dot: 'bg-(--status-critical-fg)', text: 'text-(--status-critical-fg)' },
  MEDIUM: { label: 'Medium', dot: 'bg-(--status-warning-fg)', text: 'text-(--status-warning-fg)' },
  LOW: { label: 'Low', dot: 'bg-(--status-neutral-fg)', text: 'text-(--status-neutral-fg)' },
  INFO: { label: 'Info', dot: 'bg-(--text-tertiary)', text: 'text-(--text-tertiary)' },
};

const severityOf = (view: FindingView): FaultSeverity => {
  const up = (view.severity ?? '').toUpperCase() as FaultSeverity;
  return up in SEVERITY_RANK ? up : 'MEDIUM';
};

const timeOf = (view: FindingView): number => {
  const t = view.timestamp ? Date.parse(view.timestamp) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

type SortMode = 'severity' | 'newest';

// A toggle chip used for both the category and severity filter rows.
function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'border-(--border-strong) bg-(--surface-invert) text-(--text-oninvert)'
          : 'border-(--border-hairline) bg-(--surface-inset) text-(--text-secondary) hover:text-(--text-primary)'
      }`}
    >
      {label}
      <span className={`font-mono ${active ? 'opacity-80' : 'text-(--text-tertiary)'}`}>{count}</span>
    </button>
  );
}

export default function FindingsPanel({
  entries,
  emptyState,
  live = false,
  showFilters = true,
  bare = false,
}: {
  entries: FindingEntry[];
  emptyState: ReactNode;
  live?: boolean;
  showFilters?: boolean;
  bare?: boolean;
}) {
  const [catFilter, setCatFilter] = useState<Set<BugCategory>>(new Set());
  const [sevFilter, setSevFilter] = useState<Set<FaultSeverity>>(new Set());
  const [sort, setSort] = useState<SortMode>('severity');
  const [collapsed, setCollapsed] = useState<Set<FaultSeverity>>(new Set());

  // Counts across ALL entries (stable regardless of active filters), so chips show
  // the real distribution and only present buckets get a chip.
  const { catCounts, sevCounts } = useMemo(() => {
    const cats = new Map<BugCategory, number>();
    const sevs = new Map<FaultSeverity, number>();
    for (const { view } of entries) {
      cats.set(view.category, (cats.get(view.category) ?? 0) + 1);
      const s = severityOf(view);
      sevs.set(s, (sevs.get(s) ?? 0) + 1);
    }
    return { catCounts: cats, sevCounts: sevs };
  }, [entries]);

  const filtered = useMemo(() => {
    const rows = entries.filter(({ view }) => {
      if (catFilter.size > 0 && !catFilter.has(view.category)) return false;
      if (sevFilter.size > 0 && !sevFilter.has(severityOf(view))) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sort === 'newest') return timeOf(b.view) - timeOf(a.view);
      const rank = SEVERITY_RANK[severityOf(b.view)] - SEVERITY_RANK[severityOf(a.view)];
      return rank !== 0 ? rank : timeOf(b.view) - timeOf(a.view);
    });
    return rows;
  }, [entries, catFilter, sevFilter, sort]);

  // Contiguous severity runs (severity sort keeps same-severity findings adjacent).
  const groups = useMemo(() => {
    const out: Array<{ sev: FaultSeverity; rows: Array<{ entry: FindingEntry; index: number }> }> = [];
    filtered.forEach((entry, index) => {
      const sev = severityOf(entry.view);
      const last = out[out.length - 1];
      if (last && last.sev === sev) last.rows.push({ entry, index });
      else out.push({ sev, rows: [{ entry, index }] });
    });
    return out;
  }, [filtered]);

  const filtersActive = catFilter.size > 0 || sevFilter.size > 0;
  const clearFilters = () => { setCatFilter(new Set()); setSevFilter(new Set()); };

  const toggle = <T,>(set: Set<T>, value: T, apply: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };
  const toggleGroup = (sev: FaultSeverity) => toggle(collapsed, sev, setCollapsed);

  if (entries.length === 0) return <>{emptyState}</>;

  const summary = filtersActive ? `${filtered.length} of ${entries.length} findings` : `${entries.length} findings`;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar — filter by family + severity, then sort. Wraps on narrow screens. */}
      {!bare && (
      <div className="flex flex-col gap-2 rounded-lg border border-(--border-hairline) bg-(--surface-panel) p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-(--text-secondary)">{summary}</span>
          <div className="flex items-center gap-1.5">
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-(--text-tertiary) transition-colors hover:text-(--text-primary)"
              >
                <X className="h-3 w-3" aria-hidden="true" /> Clear
              </button>
            )}
            <label className="flex items-center gap-1.5 text-xs font-semibold text-(--text-secondary)">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
                className="rounded border border-(--border-hairline) bg-(--surface-inset) px-1.5 py-1 text-xs font-semibold text-(--text-primary)"
              >
                <option value="severity">Severity</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
        </div>

        {showFilters && (
        <div className="scroll-rail flex flex-wrap items-center gap-1.5">
          {BUG_CATEGORY_ORDER.filter((c) => catCounts.has(c)).map((c) => (
            <FilterChip
              key={c}
              label={BUG_CATEGORY_META[c].label}
              count={catCounts.get(c) ?? 0}
              active={catFilter.has(c)}
              onClick={() => toggle(catFilter, c, setCatFilter)}
            />
          ))}
          {sevCounts.size > 0 && <span className="mx-0.5 h-4 w-px bg-(--border-hairline)" aria-hidden="true" />}
          {SEVERITY_DESC.filter((s) => sevCounts.has(s)).map((s) => (
            <FilterChip
              key={s}
              label={SEV_PRESENTATION[s].label}
              count={sevCounts.get(s) ?? 0}
              active={sevFilter.has(s)}
              onClick={() => toggle(sevFilter, s, setSevFilter)}
            />
          ))}
        </div>
        )}
      </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-(--border-hairline) bg-(--surface-inset) px-4 py-8 text-center text-[13px] text-(--text-tertiary)">
          No findings match the current filters.
          <button type="button" onClick={clearFilters} className="ml-1 font-semibold text-(--text-secondary) underline hover:text-(--text-primary)">
            Clear filters
          </button>
        </div>
      ) : (
        <div
          className="flex flex-col gap-4"
          {...(live ? { role: 'log' as const, 'aria-live': 'assertive' as const, 'aria-relevant': 'additions' as const, 'aria-label': 'Captured findings' } : {})}
        >
          {bare || sort === 'newest'
            ? filtered.map((entry, index) => <div key={entry.key}>{entry.render(index)}</div>)
            : groups.map(({ sev, rows }) => {
                const isCollapsed = collapsed.has(sev);
                const pres = SEV_PRESENTATION[sev];
                return (
                  <section key={sev} className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => toggleGroup(sev)}
                      aria-expanded={!isCollapsed}
                      className="flex items-center gap-2 border-b border-(--border-hairline) pb-1.5 text-left"
                    >
                      {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-(--text-tertiary)" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5 text-(--text-tertiary)" aria-hidden="true" />}
                      <span className={`h-2 w-2 rounded-full ${pres.dot}`} aria-hidden="true" />
                      <span className={`text-xs font-bold uppercase ${pres.text}`}>{pres.label}</span>
                      <span className="font-mono text-xs text-(--text-tertiary)">{rows.length}</span>
                    </button>
                    {!isCollapsed && rows.map(({ entry, index }) => <div key={entry.key}>{entry.render(index)}</div>)}
                  </section>
                );
              })}
        </div>
      )}
    </div>
  );
}

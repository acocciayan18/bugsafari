import type { ActionRecord } from '../../../../../shared/types.js';

/**
 * Reproduction-step minimization — the causal filter between the rolling action
 * buffer and a reported finding.
 *
 * The buffer holds the last N autonomous actions, most of which have nothing to do
 * with the fault. A human following that raw list reproduces BugSafari's wandering,
 * not the bug. Minimization keeps only what is causally required to stand on the
 * faulting page in the faulting state:
 *
 *   1. Actions after the fault instant are dropped (they cannot have caused it).
 *   2. The timeline is cut back to the last entry into the faulting page — anything
 *      before that is unreachable-from-here history a human replaces by opening the
 *      URL directly.
 *   3. Consecutive identical actions collapse into one step with a repeat count.
 *   4. The result is capped, keeping the steps CLOSEST to the fault.
 *   5. The kept timeline always opens with a navigation, so it starts from a state a
 *      developer can actually get into.
 */

const DEFAULT_MAX_STEPS = 40;

export interface MinimizeOptions {
  /** URL of the page the fault fired on. */
  faultUrl?: string;
  /** Epoch ms of the fault; actions recorded after it are not causal. */
  faultAtMs?: number;
  /** Run origin, used when the buffer is empty and no fault URL is known. */
  originUrl?: string;
  /** Culprit control selector — anchors the timeline so unrelated exploration is dropped. */
  culpritSelector?: string;
  /** Burst correlation id — when set, keep only this burst's own actions. */
  burstId?: string;
  maxSteps?: number;
}

const NAVIGATION_TYPES: ReadonlySet<ActionRecord['type']> = new Set(['NAVIGATE', 'NAVIGATION']);

/** Identity of a page for causality purposes: origin + path + hash (SPA hash routes matter). */
function pageKey(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.hash}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function toMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isSameAction(a: ActionRecord, b: ActionRecord): boolean {
  return a.type === b.type && a.selector === b.selector && a.payload === b.payload && a.url === b.url;
}

/** Fold runs of identical consecutive actions into a single record carrying repeatCount. */
function collapseRepeats(records: ActionRecord[]): ActionRecord[] {
  const collapsed: ActionRecord[] = [];
  for (const record of records) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && isSameAction(previous, record)) {
      // Additive: a record may already stand for a burst (repeatCount > 1).
      previous.repeatCount = (previous.repeatCount ?? 1) + (record.repeatCount ?? 1);
      continue;
    }
    collapsed.push({ ...record });
  }
  return collapsed;
}

/** Index of the first record of the final contiguous run on the faulting page, or -1. */
function findFaultPageEntry(records: ActionRecord[], faultKey: string): number {
  if (!faultKey) return -1;
  let entry = -1;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (pageKey(records[i].url) === faultKey) {
      entry = i;
    } else if (entry !== -1) {
      break;
    }
  }
  return entry;
}

function syntheticNavigation(url: string, timestamp: string): ActionRecord {
  return { timestamp, type: 'NAVIGATE', selector: '', url };
}

/**
 * Reduce a rolling action buffer to the minimal, causally-required timeline for one
 * fault. Pure: the input array is never mutated.
 */
export function minimizeActionRecords(records: ActionRecord[], options: MinimizeOptions = {}): ActionRecord[] {
  const { faultUrl, faultAtMs, originUrl, culpritSelector, burstId, maxSteps = DEFAULT_MAX_STEPS } = options;
  const startUrl = faultUrl ?? originUrl;
  const faultKey = pageKey(faultUrl);

  const causal = collapseRepeats(
    faultAtMs === undefined ? records : records.filter((record) => toMs(record.timestamp) <= faultAtMs),
  );

  // Burst-scoped fault: the burst's own pre-recorded actions ARE the reproduction —
  // keep only those, so unrelated exploration around them never enters the playbook.
  if (burstId) {
    const burst = causal.filter((record) => record.burstId === burstId);
    if (burst.length > 0) return openWithNavigation(burst, startUrl).slice(-maxSteps);
  }

  if (causal.length === 0) {
    return startUrl ? [syntheticNavigation(startUrl, new Date(faultAtMs ?? Date.now()).toISOString())] : [];
  }

  const entry = findFaultPageEntry(causal, faultKey);
  // Entering the fault page by navigation is a clean start; entering it by clicking a
  // control on the previous page means that one control click is required context.
  const startIndex =
    entry === -1
      ? Math.max(0, causal.length - maxSteps)
      : NAVIGATION_TYPES.has(causal[entry].type)
        ? entry
        : Math.max(0, entry - 1);

  let kept = causal.slice(startIndex).slice(-maxSteps);

  // Culprit-anchored trim: when the faulting control is known, drop interior
  // exploration hops (traversal navigations / off-page clicks) that precede it and are
  // not setup for it, AND the simultaneous burst siblings fired at the same instant on
  // OTHER controls — a single-element fault must reproduce with only its own action.
  // Only runs when the culprit is actually present, so a timeline with no match is left
  // exactly as the page/time scoping produced it.
  if (culpritSelector) {
    let lastCulprit = -1;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (kept[i].selector === culpritSelector) { lastCulprit = i; break; }
    }
    if (lastCulprit >= 0) {
      // A sibling of the same concurrent burst: shares the culprit's burstId but acted on
      // a different control. These are the unrelated simultaneous clicks to strip.
      const culpritBurst = kept[lastCulprit].burstId;
      const isBurstSibling = (record: ActionRecord): boolean =>
        Boolean(culpritBurst) && record.burstId === culpritBurst && record.selector !== culpritSelector;
      kept = kept.filter(
        (record, i) =>
          !isBurstSibling(record) &&
          (i >= lastCulprit || // the culprit and everything after it
            (i === 0 && NAVIGATION_TYPES.has(record.type)) || // the opening navigation
            !isTraversal(record, faultKey)), // genuine setup (inputs/submits), never traversal
      );
    }
  }

  return openWithNavigation(kept, startUrl);
}

// A step that merely moved BugSafari to another place rather than acting on the fault:
// an explicit navigation, or a click whose observed outcome left the faulting page.
function isTraversal(record: ActionRecord, faultKey: string): boolean {
  if (NAVIGATION_TYPES.has(record.type)) return true;
  const navTo = record.outcome?.navigatedTo;
  return record.type === 'CLICK' && Boolean(navTo) && pageKey(navTo) !== faultKey;
}

// Guarantee the timeline opens from a state a developer can reach: keep a leading
// navigation as-is, else synthesize one to the first kept action's page.
function openWithNavigation(kept: ActionRecord[], startUrl?: string): ActionRecord[] {
  const first = kept[0];
  if (!first || NAVIGATION_TYPES.has(first.type)) return kept;
  return [syntheticNavigation(first.url || startUrl || '', first.timestamp), ...kept];
}

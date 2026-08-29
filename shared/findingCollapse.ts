// ═══════════════════════════════════════════════════════════════
// shared/findingCollapse.ts - ONE COLLAPSE FOR EVERY COUNT POINT
// ═══════════════════════════════════════════════════════════════
// Collapse findings into one representative per fault family (buildFaultSignature),
// reused by the mid-run checkpoint and the manual save so both persist the same count
// the operator watched live. Generic over the caller's record via an adapter, so the
// signature/representative/occurrence contract lives in exactly one place.

import { buildFaultSignature, type FaultSignatureInput } from './faultSignature.js';
import { pickFaultRepresentative, type RepresentativeFault } from './faultRepresentative.js';

export type FindingOrigin = 'server' | 'client';

export interface CollapseAdapter<T> {
  signatureInput: (item: T) => FaultSignatureInput;
  representative: (item: T) => RepresentativeFault;
  origin: (item: T) => FindingOrigin;
  occurrences: (item: T) => number;
  withOccurrences: (item: T, occurrences: number) => T;
  // Optional reportability gate; a dropped item is excluded before grouping.
  reportable?: (item: T) => boolean;
  // Optional grouping-key override. Default: buildFaultSignature(signatureInput(item)).
  identity?: (item: T) => string;
  // Optional MULTI-key grouping: items sharing ANY key collapse into one family (bugId OR
  // signature). This unifies a fault whose two records (server ledger + client payload)
  // drifted in signature but share a bugId — the same union the live tab uses — while the
  // origin-based occurrence contract still prevents a shared-events twin from double-counting.
  // Takes precedence over `identity`/signature when present.
  identityKeys?: (item: T) => string[];
  // Optional cross-member field arbitration, applied AFTER occurrences are set, so a
  // family's canonical fields (worst severity, one non-empty culprit) derive from the
  // whole bucket instead of riding along from the representative alone.
  reconcile?: (representative: T, members: T[]) => T;
}

// Finalize one family: content-richest representative, "sum within origin, max across
// origins" occurrences, then optional field reconcile.
function finalizeGroup<T>(members: T[], adapter: CollapseAdapter<T>): T {
  const rep = pickFaultRepresentative(members, adapter.representative);
  const perOrigin = new Map<FindingOrigin, number>();
  for (const item of members) {
    const o = adapter.origin(item);
    perOrigin.set(o, (perOrigin.get(o) ?? 0) + Math.max(1, adapter.occurrences(item)));
  }
  let occurrences = 0;
  for (const total of perOrigin.values()) occurrences = Math.max(occurrences, total);
  const withOcc = adapter.withOccurrences(rep, occurrences);
  return adapter.reconcile ? adapter.reconcile(withOcc, members) : withOcc;
}

// One representative per family. Occurrences follow "sum within origin, max across
// origins": a fault's server ledger entries and its client twin describe the SAME
// physical events, so summing across origins would double-count — the max keeps
// distinct within-origin manifestations (15 identical 500s ⇒ ×15) without inflating
// the twin. First-seen family order is preserved so repeated saves stay stable.
export function collapseFindings<T>(items: T[], adapter: CollapseAdapter<T>): T[] {
  const kept = adapter.reportable ? items.filter((i) => adapter.reportable!(i)) : items;

  // Multi-key union: an item joins the first group it shares any key with (bugId OR
  // signature), else opens a new one. Single-pass, first-seen order — matching the live
  // collapse — so repeated saves stay stable.
  if (adapter.identityKeys) {
    const groups: T[][] = [];
    const keyToGroup = new Map<string, number>();
    for (const item of kept) {
      const keys = adapter.identityKeys(item).filter((k) => k !== '');
      let gi: number | undefined;
      for (const k of keys) {
        if (keyToGroup.has(k)) { gi = keyToGroup.get(k); break; }
      }
      if (gi === undefined) { gi = groups.length; groups.push([]); }
      groups[gi].push(item);
      for (const k of keys) keyToGroup.set(k, gi);
    }
    return groups.map((members) => finalizeGroup(members, adapter));
  }

  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const item of kept) {
    const key = adapter.identity ? adapter.identity(item) : buildFaultSignature(adapter.signatureInput(item));
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
      order.push(key);
    }
  }
  return order.map((key) => finalizeGroup(groups.get(key)!, adapter));
}

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
}

// One representative per family. Occurrences follow "sum within origin, max across
// origins": a fault's server ledger entries and its client twin describe the SAME
// physical events, so summing across origins would double-count — the max keeps
// distinct within-origin manifestations (15 identical 500s ⇒ ×15) without inflating
// the twin. First-seen family order is preserved so repeated saves stay stable.
export function collapseFindings<T>(items: T[], adapter: CollapseAdapter<T>): T[] {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (adapter.reportable && !adapter.reportable(item)) continue;
    const key = buildFaultSignature(adapter.signatureInput(item));
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const bucket = groups.get(key)!;
    const rep = pickFaultRepresentative(bucket, adapter.representative);
    const perOrigin = new Map<FindingOrigin, number>();
    for (const item of bucket) {
      const o = adapter.origin(item);
      perOrigin.set(o, (perOrigin.get(o) ?? 0) + Math.max(1, adapter.occurrences(item)));
    }
    let occurrences = 0;
    for (const total of perOrigin.values()) occurrences = Math.max(occurrences, total);
    return adapter.withOccurrences(rep, occurrences);
  });
}

// ═══════════════════════════════════════════════════════════════
// shared/faultRepresentative.ts - DETERMINISTIC FAMILY REPRESENTATIVE
// ═══════════════════════════════════════════════════════════════
// Content-derived pick of the ONE representative among findings that share a fault
// signature. Namespace-independent (never keys on bugId) so the live buffer collapse
// and the saved-history collapse choose the SAME survivor from co-emitted content,
// keeping the reproduction steps an operator watches live byte-identical to the report.

import { SEVERITY_RANK } from './severity.js';
import type { FaultSeverity } from './types/bug.js';
import { BUG_CATEGORY_ORDER, resolveCategory } from './bugCategory.js';

export interface RepresentativeFault {
  reproductionSteps?: string[];
  timestamp?: number | string | Date;
  // The verdict a merged family should carry: a security/higher-severity member wins so the
  // leak verdict is never lost to a plain-500 twin sharing its signature. Both optional so
  // callers that don't supply them fall straight through to the reproduction-richness order.
  bugClass?: string;
  severity?: string;
}

// Higher = more severe; an unknown/absent severity sorts below every real one.
function severityScore(f: RepresentativeFault): number {
  const rank = f.severity ? SEVERITY_RANK[f.severity as FaultSeverity] : undefined;
  return rank ?? -1;
}

// Lower = more safety-critical family (SECURITY first). Absent class resolves to the default.
function categoryRank(f: RepresentativeFault): number {
  return BUG_CATEGORY_ORDER.indexOf(resolveCategory(f.bugClass));
}

function stepCount(f: RepresentativeFault): number {
  return Array.isArray(f.reproductionSteps) ? f.reproductionSteps.length : 0;
}

function stepText(f: RepresentativeFault): string {
  return Array.isArray(f.reproductionSteps) ? f.reproductionSteps.join('\n') : '';
}

function timeMs(f: RepresentativeFault): number {
  const t = f.timestamp;
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? Infinity : ms;
  }
  return Infinity;
}

// Total order: negative ⇒ a is the better representative, positive ⇒ b, 0 ⇒ content
// interchangeable. Richest reproduction wins, then the earliest sighting, then a stable
// lexical tiebreak so the result never depends on input order.
export function compareFaultRepresentatives(a: RepresentativeFault, b: RepresentativeFault): number {
  // A merged family shows its most severe, most safety-critical verdict first, so a leak
  // (SECURITY/HIGH) wins over a plain server failure (STABILITY/HIGH) it collapsed with.
  const bySeverity = severityScore(b) - severityScore(a);
  if (bySeverity !== 0) return bySeverity;
  const byCategory = categoryRank(a) - categoryRank(b);
  if (byCategory !== 0) return byCategory;
  const byCount = stepCount(b) - stepCount(a);
  if (byCount !== 0) return byCount;
  const at = stepText(a);
  const bt = stepText(b);
  if (at.length !== bt.length) return bt.length - at.length;
  const byTime = timeMs(a) - timeMs(b);
  if (byTime !== 0) return byTime;
  return at < bt ? -1 : at > bt ? 1 : 0;
}

// Choose the representative from a non-empty group. Pure and order-independent.
export function pickFaultRepresentative<T>(items: T[], project: (item: T) => RepresentativeFault): T {
  let best = items[0];
  for (let i = 1; i < items.length; i++) {
    if (compareFaultRepresentatives(project(items[i]), project(best)) < 0) best = items[i];
  }
  return best;
}

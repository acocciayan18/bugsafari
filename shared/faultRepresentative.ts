// ═══════════════════════════════════════════════════════════════
// shared/faultRepresentative.ts - DETERMINISTIC FAMILY REPRESENTATIVE
// ═══════════════════════════════════════════════════════════════
// Content-derived pick of the ONE representative among findings that share a fault
// signature. Namespace-independent (never keys on bugId) so the live buffer collapse
// and the saved-history collapse choose the SAME survivor from co-emitted content,
// keeping the reproduction steps an operator watches live byte-identical to the report.

export interface RepresentativeFault {
  reproductionSteps?: string[];
  timestamp?: number | string | Date;
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

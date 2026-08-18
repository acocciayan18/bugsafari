// Pure concurrent-burst detector for network-fault attribution.
//
// When a request fires during a burst that clicked several DISTINCT controls
// near-simultaneously ("Click 4 controls at the same time"), no single control can be
// blamed for the request — the click→request link is not captured, only timestamps. So
// naming one sibling is a guess. Attribution is ambiguous, and the finding must show the
// endpoint instead of a wrong control.

export interface ActedEntry {
  selector: string;
  actedAtMs: number;
}

// A request whose start lands within this window of two-or-more distinct clicks was fired
// during a concurrent burst. Kept tight so ordinary sequential exploration clicks (further
// apart than this) still attribute to their own control; a real burst fires within a few ms.
export const BURST_AMBIGUITY_WINDOW_MS = 120;

/**
 * True when two or more DISTINCT controls were acted within `windowMs` of `atMs` — a
 * concurrent burst in which the request's issuing control cannot be identified. A single
 * control (even clicked repeatedly, e.g. a double-submit) is never ambiguous.
 */
export function isConcurrentBurstAt(
  history: readonly ActedEntry[],
  atMs: number,
  windowMs: number = BURST_AMBIGUITY_WINDOW_MS,
): boolean {
  if (!Number.isFinite(atMs)) return false;
  const distinct = new Set<string>();
  for (const entry of history) {
    if (!entry?.selector) continue;
    if (Math.abs(entry.actedAtMs - atMs) <= windowMs) {
      distinct.add(entry.selector);
      if (distinct.size >= 2) return true;
    }
  }
  return false;
}

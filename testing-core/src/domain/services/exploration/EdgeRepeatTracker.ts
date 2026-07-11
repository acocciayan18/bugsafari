/**
 * EdgeRepeatTracker — session-wide structural-transition repeat budget.
 *
 * The state graph keys edges by the `combined` hash, so clicking the SAME link
 * from N combined-hash variants of one structural shell reads as N distinct
 * unvisited edges — the engine re-traverses the identical view→view transition
 * and loops (the SPA navigation-loop this fixes). This tracker collapses those by
 * keying on `structure sub-hash + selector` and counting only NON-productive
 * traversals (ones that landed back on an already-seen structure). Once a control
 * has produced `budget` such repeats it is declared exhausted and the loop blocks
 * it session-wide, redirecting to unexplored routes. A productive traversal
 * (reached a novel structure) clears the control's counter, so a sometimes-useful
 * control (e.g. pagination) is never permanently lost.
 *
 * Pure/deterministic (Map only, no timers/randomness) and memory-bounded.
 */

// Upper bound on tracked (structure, selector) keys so long runs can't grow
// memory without limit. FIFO eviction of the oldest key.
const MAX_KEYS = 5000;

export class EdgeRepeatTracker {
  private readonly repeats = new Map<string, number>();

  /** Clear all counters at the start of a new Safari run. */
  public reset(): void {
    this.repeats.clear();
  }

  private key(fromStructure: string, selector: string): string {
    return `${fromStructure}::${selector}`;
  }

  /** Count one non-productive traversal of (fromStructure, selector); returns the new count. */
  public recordRepeat(fromStructure: string, selector: string): number {
    if (!fromStructure || !selector) return 0;
    const k = this.key(fromStructure, selector);
    if (!this.repeats.has(k) && this.repeats.size >= MAX_KEYS) {
      const oldest = this.repeats.keys().next().value;
      if (oldest !== undefined) this.repeats.delete(oldest);
    }
    const next = (this.repeats.get(k) ?? 0) + 1;
    this.repeats.set(k, next);
    return next;
  }

  /** A productive traversal (reached a novel structure) clears accumulated repeats. */
  public recordProductive(fromStructure: string, selector: string): void {
    if (!fromStructure || !selector) return;
    this.repeats.delete(this.key(fromStructure, selector));
  }

  /** Current non-productive repeat count for this control (0 if none). */
  public repeatCount(fromStructure: string, selector: string): number {
    return this.repeats.get(this.key(fromStructure, selector)) ?? 0;
  }

  /** True when this control has hit its per-session budget. budget<=0 disables the cap. */
  public isExhausted(fromStructure: string, selector: string, budget: number): boolean {
    if (budget <= 0) return false;
    return this.repeatCount(fromStructure, selector) >= budget;
  }
}

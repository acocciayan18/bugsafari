// ═══════════════════════════════════════════════════════════════
// verification/networkFaultArbiter.ts — DEFERRED PROMOTION (pure state)
// ═══════════════════════════════════════════════════════════════
// A transport failure is infrastructure telemetry until it is shown to have BROKEN
// something: the app throws, logs an error, or rejects a promise because the call
// died. That proof arrives AFTER the failure (the fetch rejects, then the handler
// throws), so the failure is parked here with its frozen evidence and promoted
// only if a runtime fault lands inside the correlation window.
//
// No timers: an unclaimed entry simply expires the next time the arbiter is
// touched, so a run that never throws promotes nothing and costs nothing.

/** How long after a network failure a runtime fault still counts as caused by it. */
const CORRELATION_WINDOW_MS = 2500;
/** Bound the parked set — a failure storm must not grow memory. */
const MAX_PENDING = 24;

export interface PendingNetworkFault<TEvidence> {
  /** Endpoint the failed request targeted (origin+path is enough to correlate). */
  urlKey: string;
  /** Epoch ms the request failed. */
  atMs: number;
  /** Everything needed to report the finding later, frozen at failure time. */
  evidence: TEvidence;
}

function urlKeyOf(url: string | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return (url.split('?')[0] ?? url).toLowerCase();
  }
}

/**
 * Parks network failures and hands back the ones a subsequent runtime fault
 * proves were consequential. Generic over the evidence payload so the monitor can
 * store whatever it needs to emit the finding without this class knowing about
 * telemetry, Playwright, or the database.
 */
export class NetworkFaultArbiter<TEvidence> {
  private readonly pending: PendingNetworkFault<TEvidence>[] = [];

  constructor(
    private readonly windowMs: number = CORRELATION_WINDOW_MS,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /** Park a failure that routed to the Network tab but could still prove consequential. */
  public hold(url: string | undefined, evidence: TEvidence, atMs: number = this.nowMs()): void {
    this.expire(atMs);
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push({ urlKey: urlKeyOf(url), atMs, evidence });
  }

  /**
   * Report a runtime fault. Returns every parked failure inside the window — those
   * are now promotable findings ("the request died and the UI threw"). Claimed
   * entries are removed so one fault can never promote the same failure twice.
   */
  public claimCausedBy(faultAtMs: number = this.nowMs()): TEvidence[] {
    this.expire(faultAtMs);
    const claimed: TEvidence[] = [];
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const entry = this.pending[i];
      if (faultAtMs >= entry.atMs && faultAtMs - entry.atMs <= this.windowMs) {
        claimed.push(entry.evidence);
        this.pending.splice(i, 1);
      }
    }
    return claimed.reverse();
  }

  public get size(): number {
    return this.pending.length;
  }

  public reset(): void {
    this.pending.length = 0;
  }

  private expire(nowMs: number): void {
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (nowMs - this.pending[i].atMs > this.windowMs) this.pending.splice(i, 1);
    }
  }
}

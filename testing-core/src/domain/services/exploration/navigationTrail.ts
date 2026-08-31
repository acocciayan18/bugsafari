// ═══════════════════════════════════════════════════════════════
// exploration/navigationTrail.ts — SELF-CAUSED CANCELLATION (pure state)
// ═══════════════════════════════════════════════════════════════
// A request the engine tears down by navigating away (click a link, goto a route)
// fails with net::ERR_FAILED — a harness artifact, not an app defect. The text-only
// abort filter misses it, so it is parked and later mis-promoted as BROKE_UI.
// This ring records BugSafari-initiated navigations with timestamps so the
// requestfailed handler can ask "was this request in flight when I navigated?".
//
// No timers: stale marks expire the next time the trail is touched.

/** How long a mark stays relevant — bounds memory and stale straddles. */
const RETENTION_MS = 10000;
/** Bound the ring — a navigation storm must not grow memory. */
const MAX_MARKS = 32;
/** Clock-skew padding so a nav landing just after the failure still counts. */
export const NAV_STRADDLE_SLACK_MS = 250;

export interface NavigationMark {
  url: string;
  /** Epoch ms the navigation was observed. */
  atMs: number;
  /** True when a BugSafari action (click/goto) caused this navigation. */
  engineInitiated: boolean;
}

/** Records engine navigations and answers whether one superseded an in-flight request. */
export class NavigationTrail {
  private readonly marks: NavigationMark[] = [];

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  public record(mark: NavigationMark): void {
    this.expire(mark.atMs);
    if (this.marks.length >= MAX_MARKS) this.marks.shift();
    this.marks.push(mark);
  }

  /** True when an engine-initiated navigation happened while the request was in flight. */
  public supersededInFlight(startMs: number | undefined, endMs: number): boolean {
    if (startMs === undefined) return false;
    this.expire(endMs);
    return this.marks.some(
      (m) => m.engineInitiated && m.atMs >= startMs && m.atMs <= endMs + NAV_STRADDLE_SLACK_MS,
    );
  }

  public reset(): void {
    this.marks.length = 0;
  }

  private expire(nowMs: number): void {
    for (let i = this.marks.length - 1; i >= 0; i -= 1) {
      if (nowMs - this.marks[i].atMs > RETENTION_MS) this.marks.splice(i, 1);
    }
  }
}

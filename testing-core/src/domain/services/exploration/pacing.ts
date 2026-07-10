/**
 * Pure adaptive-pacing decisions, extracted so the timing policy is unit-testable
 * without a Page (audit D2/D3: fixed waits + a full 3s verify poll on every click
 * — including no-op clicks that never diverge — wasted a large share of the
 * timebox and re-hashed the DOM up to 10× per click).
 */

export interface NoOpExitInputs {
  /** Milliseconds elapsed since traversal verification started. */
  elapsedMs: number;
  /** Minimum observation floor — never bail before this (give a real transition
   *  time to begin rendering). */
  minObserveMs: number;
  /** Network requests currently outstanding on the page. */
  inFlightRequests: number;
  /** Milliseconds since the last request/response network event. */
  msSinceLastActivity: number;
  /** Required network-quiet duration before a stable-unchanged DOM counts as no-op. */
  quietMs: number;
  /** Absolute no-op ceiling: bail on an unchanged DOM past this even if the page
   *  never goes network-quiet (analytics/ad beacons, websockets, long-poll keep
   *  firing forever). Bounds the no-op cost on exactly the ad-heavy pages that
   *  motivated the fix, while staying below the hard poll cap. */
  noOpCeilingMs: number;
}

/**
 * True when the post-click DOM is still unchanged and a real state change is very
 * unlikely to still be coming, so verification can stop early instead of polling
 * the whole budget. Two independent exits, both gated behind the observation
 * floor: (1) the network went idle for `quietMs` — the clean fast path; or
 * (2) the absolute `noOpCeilingMs` elapsed — so a perpetually-chattering page
 * can't pin verification at the hard cap. In-flight requests below the ceiling
 * keep the window open so a slow backend-driven transition is never cut short.
 */
export function shouldExitNoOp(i: NoOpExitInputs): boolean {
  if (i.elapsedMs < i.minObserveMs) return false;
  if (i.elapsedMs >= i.noOpCeilingMs) return true;
  if (i.inFlightRequests > 0) return false;
  return i.msSinceLastActivity >= i.quietMs;
}

/**
 * Pure gate for attributing an async network signal (xhr/fetch) to the acting
 * element as a perceptron reward. A click's own request fires within a beat and
 * only a few times; beyond a short causal window or a per-action cap the traffic
 * is background SPA chatter (socket.io polling, lazy assets) the element never
 * caused — training on it inflates weights from noise (observed as a reward flood
 * on OWASP Juice Shop, ~80 boosts between two clicks). Extracted so the timing
 * policy is unit-testable without a live Page.
 */

export interface NetworkAttributionInputs {
  /** Milliseconds since the current acted-on element was recorded. */
  msSinceAction: number;
  /** Network-signal rewards already attributed to the current action. */
  rewardsThisAction: number;
  /** Causal window: reject signals arriving later than this after the action. */
  windowMs: number;
  /** Per-action cap on attributed network-signal rewards. */
  maxPerAction: number;
}

/** True when this xhr/fetch is plausibly caused by the acting element and still
 *  under the per-action cap, so it may reward that element's feature weights. */
export function shouldAttributeNetworkSignal(i: NetworkAttributionInputs): boolean {
  if (i.msSinceAction > i.windowMs) return false;
  if (i.rewardsThisAction >= i.maxPerAction) return false;
  return true;
}

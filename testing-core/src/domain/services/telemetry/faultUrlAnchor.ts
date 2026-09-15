// Pure fallback chain for a network fault's reproduction anchor. Prefer the page active when the
// request STARTED (consistent with the endpoint named in the finding message), then the last
// known engine URL, then the live page URL. Kept side-effect-free so the precedence is unit-tested.

export function resolveReproFaultUrl(
  activeAtStart: string | undefined,
  lastKnown: string | undefined,
  pageUrl: string | undefined,
): string {
  return activeAtStart || lastKnown || pageUrl || '';
}

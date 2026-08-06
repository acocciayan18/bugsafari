// Pure streak policy behind the browser-view target-degradation signal. A single
// transport failure is normal noise; only a run of consecutive failures to the
// target origin (with no successful response between) means the target genuinely
// dropped. Extracted so the threshold logic is unit-testable without a live Page.

export interface DegradeState {
  consecutiveFailures: number;
  degraded: boolean;
}

export function initialDegradeState(): DegradeState {
  return { consecutiveFailures: 0, degraded: false };
}

// Record one target-origin transport failure. enterDegraded is true exactly on the
// transition into the degraded state (streak first reaches the threshold).
export function onTargetFailure(
  state: DegradeState,
  streakThreshold: number,
): { state: DegradeState; enterDegraded: boolean } {
  const consecutiveFailures = state.consecutiveFailures + 1;
  const shouldDegrade = consecutiveFailures >= streakThreshold;
  const enterDegraded = shouldDegrade && !state.degraded;
  return {
    state: { consecutiveFailures, degraded: state.degraded || shouldDegrade },
    enterDegraded,
  };
}

// Record one successful target-origin response. exitDegraded is true exactly on the
// transition back to healthy; a single success clears the streak (matches the
// TargetHealthMonitor's reset-on-any-reachable-probe policy).
export function onTargetSuccess(state: DegradeState): { state: DegradeState; exitDegraded: boolean } {
  const exitDegraded = state.degraded;
  return { state: initialDegradeState(), exitDegraded };
}

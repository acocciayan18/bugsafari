import type { EngineHealthPhase } from '../../../../shared/types.js';

// How long an engine may go without a heartbeat before the dashboard is told it has
// stopped responding. Comfortably above the worker's 3s stamp cadence, so a GC pause,
// a slow Atlas round-trip, or a 0.6-vCPU worker under a Chromium burst never trips it.
export const ENGINE_STALE_MS = readPositiveInt(process.env.BUGSAFARI_ENGINE_STALE_MS, 45_000);

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Is the engine unresponsive?
 *
 * A null age means no heartbeat has been recorded YET, which is the normal state of a
 * run that just started; reporting that as stalled would flag every launch. Absence is
 * therefore never evidence — only a stamp that has aged past the threshold is.
 */
export function isEngineStale(lastHeartbeatAgeMs: number | null, threshold = ENGINE_STALE_MS): boolean {
  if (lastHeartbeatAgeMs === null) return false;
  return lastHeartbeatAgeMs > threshold;
}

export function engineHealthPhase(lastHeartbeatAgeMs: number | null, threshold = ENGINE_STALE_MS): EngineHealthPhase {
  return isEngineStale(lastHeartbeatAgeMs, threshold) ? 'stalled' : 'live';
}

/**
 * Should a health change be announced? Only a transition is worth a push: re-emitting
 * 'stalled' on every sweep would spam a run room for the rest of its timebox, and the
 * recovery edge is exactly what clears the operator's banner.
 */
export function shouldAnnounceHealth(previous: EngineHealthPhase | undefined, next: EngineHealthPhase): boolean {
  return previous !== next;
}

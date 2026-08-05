// Per-user first-run tour completion flag. Keyed by user id so accounts sharing a
// browser stay isolated; guests fall back to a shared key.

const TOUR_KEY_PREFIX = 'bugsafari_tour_done';

function keyFor(userId: string | null): string {
  return `${TOUR_KEY_PREFIX}:${userId ?? 'guest'}`;
}

export function hasCompletedTour(userId: string | null): boolean {
  try {
    return localStorage.getItem(keyFor(userId)) === 'true';
  } catch {
    // Blocked storage — treat as done so the tour never nags on every mount.
    return true;
  }
}

export function markTourCompleted(userId: string | null): void {
  try {
    localStorage.setItem(keyFor(userId), 'true');
  } catch {
    console.warn('[tour] failed to persist completion');
  }
}

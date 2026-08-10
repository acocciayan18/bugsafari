// Per-user, per-tour first-run completion flag. Keyed by tour id AND user id so each
// page's tour is tracked on its own and accounts sharing a browser stay isolated;
// guests fall back to a shared key.

const TOUR_KEY_PREFIX = 'bugsafari_tour_done';

function keyFor(tourId: string, userId: string | null): string {
  return `${TOUR_KEY_PREFIX}:${tourId}:${userId ?? 'guest'}`;
}

export function hasCompletedTour(tourId: string, userId: string | null): boolean {
  try {
    return localStorage.getItem(keyFor(tourId, userId)) === 'true';
  } catch {
    // Blocked storage — treat as done so the tour never nags on every mount.
    return true;
  }
}

export function markTourCompleted(tourId: string, userId: string | null): void {
  try {
    localStorage.setItem(keyFor(tourId, userId), 'true');
  } catch {
    console.warn('[tour] failed to persist completion');
  }
}

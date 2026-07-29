// Single source of the API origin. Empty means same-origin (Vite dev proxy);
// in production the deployed dashboard has no proxy, so relative /api paths
// hit the static host and 405. Always build request URLs through apiUrl().
export const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? '';

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

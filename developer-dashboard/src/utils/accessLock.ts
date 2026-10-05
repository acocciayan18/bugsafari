// Temporary development-only system lock. Frontend-only shared-secret gate that
// sits above the auth layer, a stored JWT or guest session cannot bypass it.
export const ACCESS_PASSWORD = 'Bugsafari_2026';
const STORAGE_KEY = 'bugsafari_access_key';

export function getAccessKey(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function isUnlocked(): boolean {
  return getAccessKey() === ACCESS_PASSWORD;
}

export function unlock(password: string): boolean {
  if (password !== ACCESS_PASSWORD) return false;
  try { localStorage.setItem(STORAGE_KEY, password); } catch { /* private mode */ }
  return true;
}

export function lock(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
